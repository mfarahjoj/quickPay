import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { assertCashInRecipient } from "../utils/agentGuards";
import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { reserveOtpAttempt, clearOtpFailures } from "../utils/otpGuard";
import { ApiResponse, AgentTopupRequest, Wallet, Transaction, User } from "../types";
import { getRates, computeCommission } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
} from "../ledger";

interface AgentConfirmTopupRequest {
  otpCode: string;
  agentPin: string;
}

interface AgentConfirmTopupResponse {
  amount: number;
  customerName: string;
  commission: number;
  confirmationId: string;
}

/**
 * Agent confirms a customer's Zapp Agent top-up (by scanning the QR or entering
 * the 6-digit code) after receiving the cash. Credits the customer's wallet the
 * full amount (platform-funded), pays the agent commission from the platform,
 * and records a unique confirmation id. Mirrors agentConfirmCashOut.
 */
export const agentConfirmTopup = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<AgentConfirmTopupRequest>
  ): Promise<ApiResponse<AgentConfirmTopupResponse>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;

    const { otpCode, agentPin } = request.data;

    if (!otpCode || otpCode.length !== 6) {
      throw new https.HttpsError("invalid-argument", "6-digit code required");
    }

    if (!agentPin) {
      throw new https.HttpsError("invalid-argument", "Agent PIN is required");
    }

    const db = admin.firestore();

    // Verify agent role
    const agentDoc = await db.collection("users").doc(agentId).get();
    if (!agentDoc.exists) {
      throw new https.HttpsError("not-found", "Agent not found");
    }
    const agentData = agentDoc.data() as User;
    // Only vetted agents handle customers' cash. A plain merchant accepts
    // payments; it was never approved to run cash-in, and cash-out already
    // refused it — the two sides now agree.
    if (
      agentData.accountType !== "topup_agent" &&
      agentData.accountType !== "agent_merchant"
    ) {
      throw new https.HttpsError(
        "permission-denied",
        "Only agents can confirm top-ups"
      );
    }
    // The agent's own float funds this credit, so a frozen agent cannot issue.
    assertAccountActive(agentData);

    // The agent's float is debited here, which makes this a user-initiated
    // debit and puts it under the same PIN rule as manualTopup. Without it,
    // anyone holding an unlocked agent phone — a staff member, a thief — could
    // hand a colluding customer float the agent has already paid for, and the
    // customer's OTP is no obstacle when the two are working together.
    const pinValid = await verifyUserPin(agentId, agentPin);
    if (!pinValid) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    // Spending float is outgoing money: it waits out the pause after a reset.
    await assertResetCooldownAllows(agentId, "other", 0);

    // Rate-limit code guesses so the 6-digit space can't be brute-forced.
    // The guess is counted before the lookup, so parallel calls can't each
    // slip one in under the lock.
    await reserveOtpAttempt(agentId);

    // Find the pending top-up with this code
    const snapshot = await db
      .collection("agentTopupRequests")
      .where("otpCode", "==", otpCode)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new https.HttpsError(
        "not-found",
        "Invalid or expired code. Ask the customer to generate a new one."
      );
    }
    await clearOtpFailures(agentId);

    const topupDoc = snapshot.docs[0];
    const topup = topupDoc.data() as AgentTopupRequest;

    if (agentId === topup.customerId) {
      throw new https.HttpsError(
        "permission-denied",
        "You cannot confirm your own top-up"
      );
    }

    if (new Date() > topup.expiresAt.toDate()) {
      await topupDoc.ref.update({ status: "expired" });
      throw new https.HttpsError("failed-precondition", "This code has expired");
    }

    const customerDoc = await db.collection("users").doc(topup.customerId).get();
    // Agent-to-agent cash-in moves float in a circle and pays commission on
    // every lap; a frozen customer must not be credited fresh value either.
    assertCashInRecipient(agentId, topup.customerId, customerDoc.data());
    const customerName = customerDoc.data()?.fullName || "Customer";

    const { topupCommissionRate } = await getRates();
    const commissionCents = computeCommission(topup.amount, topupCommissionRate);
    const now = admin.firestore.Timestamp.now();
    const transactionId = db.collection("transactions").doc().id;
    const confirmationId = transactionId;

    await db.runTransaction(async (tx) => {
      const freshTopup = (await tx.get(topupDoc.ref)).data() as AgentTopupRequest;
      if (freshTopup.status !== "pending") {
        throw new https.HttpsError("failed-precondition", "Code already used");
      }

      const walletRef = db.collection("wallets").doc(topup.customerId);
      const walletSnap = await tx.get(walletRef);
      if (!walletSnap.exists) {
        throw new https.HttpsError("not-found", "Customer wallet not found");
      }
      const wallet = walletSnap.data() as Wallet;

      // Float model: the agent pre-purchases e-money float, and every top-up
      // is funded from it — the agent can never distribute value they haven't
      // already paid the platform for. The cash they collect replaces the
      // float they spend, exactly like Zaad/eDahab agent economics.
      const agentWalletRef = db.collection("wallets").doc(agentId);
      const agentWalletSnap = await tx.get(agentWalletRef);
      if (!agentWalletSnap.exists) {
        throw new https.HttpsError(
          "failed-precondition",
          "Agent float wallet not found. Purchase float before confirming top-ups."
        );
      }
      const agentWallet = agentWalletSnap.data() as Wallet;
      if (agentWallet.balance < topup.amount) {
        throw new https.HttpsError(
          "failed-precondition",
          `Insufficient float. This top-up needs ${topup.currency} ${(topup.amount / 100).toFixed(2)} but your float balance is ${topup.currency} ${(agentWallet.balance / 100).toFixed(2)}.`
        );
      }

      // Agent float funds the customer's credit; commission is paid back to
      // the agent by the platform. Entry ID derives from the top-up request,
      // which completes exactly once.
      const lines: JournalLine[] = [
        { account: userAccount(agentId), debit: topup.amount, credit: 0 },
        { account: userAccount(topup.customerId), debit: 0, credit: topup.amount },
      ];
      if (commissionCents > 0) {
        lines.push({ account: PLATFORM_FEES, debit: commissionCents, credit: 0 });
        lines.push({ account: userAccount(agentId), debit: 0, credit: commissionCents });
      }

      const pending = await prepareJournalEntry(tx, {
        entryId: `agenttopup_${topupDoc.id}`,
        type: "agent_topup",
        currency: topup.currency as "USD" | "SLS",
        lines,
        refs: { transactionId, topupId: topupDoc.id },
        description: "Zapp agent top-up",
        postedBy: agentId,
      });

      pending.write(tx);

      // Transaction record
      const txRecord: Transaction = {
        type: "topup",
        fromUserId: agentId,
        toUserId: topup.customerId,
        participants: [agentId, topup.customerId],
        amount: topup.amount,
        commissionCents,
        currency: topup.currency,
        status: "completed",
        description: "Zapp agent top-up",
        reference: confirmationId,
        journalEntryId: `agenttopup_${topupDoc.id}`,
        createdAt: now,
        completedAt: now,
      };
      tx.set(db.collection("transactions").doc(transactionId), txRecord);

      // Audit record — shows in the agent's existing Top-Up History
      tx.set(db.collection("manualTopups").doc(transactionId), {
        userId: topup.customerId,
        agentId,
        amount: topup.amount,
        amountDollars: topup.amount / 100,
        commissionCents,
        commissionDollars: commissionCents / 100,
        currency: topup.currency,
        paymentMethod: "agent_cash",
        reference: confirmationId,
        notes: "",
        status: "completed",
        transactionId,
        createdAt: now,
        completedAt: now,
      });

      // Mark the request complete
      tx.update(topupDoc.ref, {
        status: "completed",
        agentId,
        transactionId,
        confirmationId,
        completedAt: now,
      });
    });

    // Live listener is the primary signal; push is the backup.
    notifyUser(
      topup.customerId,
      "topup_completed",
      "Top-up Successful",
      `${agentData.fullName} topped up your wallet with ${topup.currency} ${(topup.amount / 100).toFixed(2)}`,
      {
        type: "topup_completed",
        amount: topup.amount.toString(),
        currency: topup.currency,
        confirmationId,
      }
    ).catch((err) => console.error("Failed to notify customer:", err));

    return {
      success: true,
      data: {
        amount: topup.amount,
        customerName,
        commission: commissionCents,
        confirmationId,
      },
    };
  }
);

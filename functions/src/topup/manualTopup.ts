import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { verifyUserPin } from "../auth/validatePin";
import { validateAmount, requireAuth, dollarsToCents } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { notifyTopupCompleted } from "../utils/notifications";
import { ApiResponse, Wallet, Transaction } from "../types";
import { getRates, computeCommission } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
} from "../ledger";

interface ManualTopupRequest {
  userId: string; // User to top up
  amount: number; // In dollars
  agentPin: string; // Agent's PIN for authorization
  paymentMethod: "cash" | "bank_transfer";
  reference?: string; // Optional reference number
  notes?: string; // Optional notes
}

interface ManualTopupResponse {
  transactionId: string;
  userId: string;
  amount: number;
  newBalance: number;
  commission: number; // Agent commission earned, in dollars
}

/**
 * Callable function for agents/admins to manually top up user wallets
 * Used at physical top-up points (stores, kiosks, etc.)
 */
export const manualTopup = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ManualTopupRequest>
  ): Promise<ApiResponse<ManualTopupResponse>> => {
    // Validate authentication
    requireAuth(request);
    const agentId = request.auth!.uid;

    const { userId, amount, agentPin, paymentMethod, reference, notes } =
      request.data;

    // Validate inputs
    if (!userId) {
      throw new https.HttpsError("invalid-argument", "User ID is required");
    }

    if (!amount || amount <= 0) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be greater than 0"
      );
    }

    if (amount > 1000) {
      throw new https.HttpsError(
        "invalid-argument",
        "Maximum top-up amount is $1000 per transaction"
      );
    }

    const amountCents = dollarsToCents(amount);

    if (!validateAmount(amountCents)) {
      throw new https.HttpsError("invalid-argument", "Invalid amount");
    }

    try {
      const db = admin.firestore();

      // Verify agent exists and is authorized
      const agentDoc = await db.collection("users").doc(agentId).get();
      if (!agentDoc.exists) {
        throw new https.HttpsError("not-found", "Agent not found");
      }

      const agentData = agentDoc.data();

      // Check if agent has topup_agent role
      if (agentData?.accountType !== "topup_agent" &&
          agentData?.accountType !== "merchant" &&
          agentData?.accountType !== "agent_merchant") {
        throw new https.HttpsError(
          "permission-denied",
          "Only authorized agents can perform manual top-ups"
        );
      }
      // The agent's own float funds this credit, so a frozen agent cannot issue.
      assertAccountActive(agentData);

      // Verify agent's PIN
      const pinValid = await verifyUserPin(agentId, agentPin);
      if (!pinValid) {
        throw new https.HttpsError("permission-denied", "Invalid agent PIN");
      }

      // Outgoing money waits out the pause after a PIN reset.
      await assertResetCooldownAllows(agentId, "other", 0);

      // Verify user exists
      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }

      const { topupCommissionRate } = await getRates();
      const commissionCents = computeCommission(amountCents, topupCommissionRate);

      // Create transaction ID
      const transactionId = db.collection("transactions").doc().id;

      // Process top-up in a transaction
      let newBalance = 0;

      await db.runTransaction(async (transaction) => {
        // Get user wallet
        const walletRef = db.collection("wallets").doc(userId);
        const walletDoc = await transaction.get(walletRef);

        if (!walletDoc.exists) {
          throw new Error("User wallet not found");
        }

        // Float model: the top-up is funded from the agent's pre-purchased
        // float, so agents can never credit value they haven't paid for.
        const agentWalletRef = db.collection("wallets").doc(agentId);
        const agentWalletDoc = await transaction.get(agentWalletRef);
        if (!agentWalletDoc.exists) {
          throw new https.HttpsError(
            "failed-precondition",
            "Agent float wallet not found. Purchase float before topping up customers."
          );
        }
        const agentWallet = agentWalletDoc.data() as Wallet;
        if (agentWallet.balance < amountCents) {
          throw new https.HttpsError(
            "failed-precondition",
            `Insufficient float. This top-up needs $${amount.toFixed(2)} but your float balance is $${(agentWallet.balance / 100).toFixed(2)}.`
          );
        }

        const now = admin.firestore.Timestamp.now();

        // Agent float funds the customer's credit; commission is credited
        // back to the agent, funded by the platform.
        const lines: JournalLine[] = [
          { account: userAccount(agentId), debit: amountCents, credit: 0 },
          { account: userAccount(userId), debit: 0, credit: amountCents },
        ];
        if (commissionCents > 0) {
          lines.push({ account: PLATFORM_FEES, debit: commissionCents, credit: 0 });
          lines.push({ account: userAccount(agentId), debit: 0, credit: commissionCents });
        }

        const pending = await prepareJournalEntry(transaction, {
          entryId: `manualtopup_${transactionId}`,
          type: "agent_topup",
          currency: "USD",
          lines,
          refs: { transactionId },
          description: `Manual top-up by agent (${paymentMethod})`,
          postedBy: agentId,
        });

        newBalance = pending.resultingBalances.get(userAccount(userId)) ?? 0;

        pending.write(transaction);

        // Create transaction record
        const txRecord: Transaction = {
          type: "topup",
          fromUserId: agentId, // Agent who performed top-up
          toUserId: userId,
          participants: [agentId, userId],
          amount: amountCents,
          commissionCents,
          currency: "USD",
          status: "completed",
          description: `Manual top-up by agent (${paymentMethod})`,
          reference: reference || undefined,
          journalEntryId: `manualtopup_${transactionId}`,
          createdAt: now,
          completedAt: now,
        };

        const transactionRef = db.collection("transactions").doc(transactionId);
        transaction.set(transactionRef, txRecord);

        // Create manual top-up record for audit
        const topupRecord = {
          userId,
          agentId,
          amount: amountCents,
          amountDollars: amount,
          commissionCents,
          commissionDollars: commissionCents / 100,
          currency: "USD",
          paymentMethod,
          reference: reference || "",
          notes: notes || "",
          status: "completed",
          transactionId,
          createdAt: now,
          completedAt: now,
        };

        const topupRef = db.collection("manualTopups").doc(transactionId);
        transaction.set(topupRef, topupRecord);
      });

      // Send notification to user
      notifyTopupCompleted(userId, amountCents, "USD", paymentMethod).catch(
        (err) => console.error("Failed to notify user:", err)
      );

      console.log(
        `Manual top-up successful: ${transactionId}, Agent: ${agentId}, User: ${userId}, Amount: $${amount}`
      );

      return {
        success: true,
        data: {
          transactionId,
          userId,
          amount,
          newBalance: newBalance / 100, // Convert to dollars
          commission: commissionCents / 100,
        },
      };
    } catch (error: any) {
      console.error("Error processing manual top-up:", error);
      if (error instanceof https.HttpsError) throw error;
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to process top-up"
      );
    }
  }
);

/**
 * Get manual top-up history for an agent
 */
export const getAgentTopupHistory = https.onCall(
  async (
    request: https.CallableRequest<{ limit?: number }>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const agentId = request.auth!.uid;
    const { limit = 50 } = request.data;

    try {
      const db = admin.firestore();

      // Verify agent authorization
      const agentDoc = await db.collection("users").doc(agentId).get();
      if (!agentDoc.exists) {
        throw new https.HttpsError("not-found", "Agent not found");
      }

      const agentData = agentDoc.data();
      if (
        agentData?.accountType !== "topup_agent" &&
        agentData?.accountType !== "merchant" &&
        agentData?.accountType !== "agent_merchant"
      ) {
        throw new https.HttpsError(
          "permission-denied",
          "Not authorized to view top-up history"
        );
      }

      // Get top-ups performed by this agent
      const topupsSnapshot = await db
        .collection("manualTopups")
        .where("agentId", "==", agentId)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      const topups = topupsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt.toDate(),
      }));

      return {
        success: true,
        data: topups,
      };
    } catch (error: any) {
      console.error("Error getting top-up history:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to get top-up history"
      );
    }
  }
);

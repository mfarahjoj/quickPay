import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { assertCashInRecipient } from "../utils/agentGuards";
import { verifyUserPin } from "../auth/validatePin";
import { notifyUser } from "../utils/notifications";
import { reserveOtpAttempt, clearOtpFailures } from "../utils/otpGuard";
import { ApiResponse, AgentTopupRequest, Transaction, User } from "../types";
import { maybeUnlockReferral } from "../referral/referralBonus";
import { readFloatCents } from "../agents/float";
import { getRates, computeCommission } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  agentAccount,
  JournalLine,
  PLATFORM_FEES,
} from "../ledger";
import { codesMatch, findPendingRequest, isSixDigitCode } from "./requestTarget";

/** Which request the code is for: from the customer's QR, or their phone typed with the code. */
interface TopupTarget {
  otpCode: string;
  /** From the customer's QR. */
  requestId?: string;
  /** Typed by the agent when there is no QR: the customer's phone number. */
  customerPhone?: string;
}

interface AgentConfirmTopupRequest extends TopupTarget {
  agentPin: string;
  /**
   * The amount the agent was shown before entering their PIN, in cents. The
   * top-up is refused unless it matches the request, so the agent's float
   * only ever pays out what their screen said.
   */
  expectedAmount: number;
}

interface AgentConfirmTopupResponse {
  amount: number;
  customerName: string;
  commission: number;
  confirmationId: string;
}

interface PreviewAgentTopupResponse {
  requestId: string;
  /** What the customer asked for, in cents: the cash the agent should take. */
  amount: number;
  currency: string;
  customerName: string;
  /** Seconds until the customer's code runs out. */
  expiresInSeconds: number;
}

const INVALID_CODE = "Invalid or expired code. Ask the customer to generate a new one.";

function assertTarget(data: Partial<TopupTarget>): void {
  if (!isSixDigitCode(data.otpCode)) {
    throw new https.HttpsError("invalid-argument", "6-digit code required");
  }
}

function assertNamesOneRequest(data: Partial<TopupTarget>): void {
  if (!data.requestId && !data.customerPhone) {
    // A code alone can belong to two waiting customers at once; older
    // merchant builds that send only the code must update.
    throw new https.HttpsError(
      "failed-precondition",
      "Scan the customer's top-up QR, or enter their phone number with the code. Update Zapp Pay Merchant if you can't.",
      { reason: "target_required" }
    );
  }
}

/** The caller, if they are an agent who may hand out float right now. */
async function requireActiveAgent(
  db: FirebaseFirestore.Firestore,
  agentId: string,
  verb: string
): Promise<User> {
  const agentDoc = await db.collection("users").doc(agentId).get();
  if (!agentDoc.exists) {
    throw new https.HttpsError("not-found", "Agent not found");
  }
  const agentData = agentDoc.data() as User;
  // Only vetted agents handle customers' cash. A plain merchant accepts
  // payments; it was never approved to run cash-in, and cash-out already
  // refused it — the two sides agree.
  if (agentData.accountType !== "topup_agent" && agentData.accountType !== "agent_merchant") {
    throw new https.HttpsError("permission-denied", `Only agents can ${verb} top-ups`);
  }
  // The agent's own float funds this credit, so a frozen agent cannot issue.
  assertAccountActive(agentData);
  return agentData;
}

interface VerifiedTopup {
  ref: FirebaseFirestore.DocumentReference;
  topup: AgentTopupRequest;
  customerName: string;
}

/**
 * Find the one request the agent named and check their code against it.
 *
 * The guess is counted against the agent before anything is looked up, so
 * parallel calls can't each slip one in under the lock, and given back when
 * the code is right. A request that doesn't exist, isn't pending, or has a
 * different code all read the same: the caller learns nothing about which.
 */
async function verifyTopupCode(
  db: FirebaseFirestore.Firestore,
  agentId: string,
  target: TopupTarget
): Promise<VerifiedTopup> {
  await reserveOtpAttempt(agentId);

  const ref = await findPendingRequest(db, "agentTopupRequests", target);
  const snap = ref ? await ref.get() : null;
  const topup = snap?.exists ? (snap.data() as AgentTopupRequest) : null;
  if (!ref || !topup || topup.status !== "pending" || !codesMatch(target.otpCode, topup.otpCode)) {
    throw new https.HttpsError("not-found", INVALID_CODE);
  }
  await clearOtpFailures(agentId);

  if (agentId === topup.customerId) {
    throw new https.HttpsError("permission-denied", "You cannot confirm your own top-up");
  }

  if (new Date() > topup.expiresAt.toDate()) {
    await ref.update({ status: "expired" });
    throw new https.HttpsError("failed-precondition", "This code has expired");
  }

  const customerDoc = await db.collection("users").doc(topup.customerId).get();
  // Agent-to-agent cash-in moves float in a circle and pays commission on
  // every lap; a frozen customer must not be credited fresh value either.
  assertCashInRecipient(agentId, topup.customerId, customerDoc.data());
  const customerName = customerDoc.data()?.fullName || "Customer";

  return { ref, topup, customerName };
}

function insufficientFloat(topup: AgentTopupRequest, floatCents: number): https.HttpsError {
  return new https.HttpsError(
    "failed-precondition",
    `Insufficient float. This top-up needs ${topup.currency} ${(topup.amount / 100).toFixed(2)} but your float is ${topup.currency} ${(floatCents / 100).toFixed(2)}.`,
    { reason: "insufficient_float", floatCents }
  );
}

/**
 * What the agent is about to pay for, shown before they take the cash and
 * enter their PIN.
 *
 * The customer chooses the amount in their own app, and it comes out of the
 * agent's float. Until this existed the agent's app sent the code and PIN and
 * learned the amount from the success screen: a customer could ask for $500,
 * hand over $50, and the agent found out after their float had paid. Now the
 * agent sees the customer's name and the amount first, and agentConfirmTopup
 * refuses any amount but the one shown here.
 *
 * It also leaves a trace. The request records which agent scanned it and
 * when, so a customer whose cash was taken but never credited has an agent to
 * name in their dispute (disputes.ts) instead of nobody.
 */
export const previewAgentTopup = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<TopupTarget>
  ): Promise<ApiResponse<PreviewAgentTopupResponse>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;
    const data = request.data ?? ({} as TopupTarget);
    assertTarget(data);
    assertNamesOneRequest(data);

    const db = admin.firestore();
    await requireActiveAgent(db, agentId, "confirm");
    const { ref, topup, customerName } = await verifyTopupCode(db, agentId, data);

    // Said now, while the cash is still in the customer's hand.
    const floatCents = await readFloatCents(agentId);
    if (floatCents < topup.amount) {
      throw insufficientFloat(topup, floatCents);
    }

    await ref.update({ scannedBy: agentId, scannedAt: admin.firestore.Timestamp.now() });

    return {
      success: true,
      data: {
        requestId: ref.id,
        amount: topup.amount,
        currency: topup.currency,
        customerName,
        expiresInSeconds: Math.max(0, Math.round((topup.expiresAt.toMillis() - Date.now()) / 1000)),
      },
    };
  }
);

/**
 * Agent confirms a customer's Zapp Agent top-up after receiving the cash.
 *
 * Every call names one request (the id from the customer's QR, or the
 * customer's phone number typed with the code) and carries the amount the
 * agent was shown by previewAgentTopup. The customer's wallet is credited the
 * full amount from the agent's float, the agent's commission is paid from the
 * platform, and a unique confirmation id is recorded. Mirrors
 * agentConfirmCashOut.
 */
export const agentConfirmTopup = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<AgentConfirmTopupRequest>
  ): Promise<ApiResponse<AgentConfirmTopupResponse>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;

    const data = request.data ?? ({} as AgentConfirmTopupRequest);
    const { agentPin, expectedAmount } = data;

    assertTarget(data);
    if (!agentPin) {
      throw new https.HttpsError("invalid-argument", "Agent PIN is required");
    }
    assertNamesOneRequest(data);
    if (!Number.isInteger(expectedAmount) || expectedAmount <= 0) {
      // Builds that confirm without first showing the agent the amount.
      throw new https.HttpsError(
        "failed-precondition",
        "Update Zapp Pay Merchant to confirm top-ups: it now shows you the amount before you enter your PIN.",
        { reason: "amount_required" }
      );
    }

    const db = admin.firestore();
    const agentData = await requireActiveAgent(db, agentId, "confirm");

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

    const { ref: topupRef, topup, customerName } = await verifyTopupCode(db, agentId, data);

    // Checked only once the code has matched, so it can't be used to learn
    // the amount of a request the caller has no code for.
    if (expectedAmount !== topup.amount) {
      throw new https.HttpsError(
        "failed-precondition",
        "The customer asked for a different amount than the one you were shown. Scan their code again.",
        { reason: "amount_mismatch" }
      );
    }

    const { cashInCommissionRate } = await getRates();
    const commissionCents = computeCommission(topup.amount, cashInCommissionRate);
    const now = admin.firestore.Timestamp.now();
    const transactionId = db.collection("transactions").doc().id;
    const confirmationId = transactionId;
    const entryId = `agenttopup_${topupRef.id}`;

    await db.runTransaction(async (tx) => {
      const freshTopup = (await tx.get(topupRef)).data() as AgentTopupRequest;
      if (freshTopup.status !== "pending") {
        throw new https.HttpsError("failed-precondition", "Code already used");
      }

      const walletSnap = await tx.get(db.collection("wallets").doc(topup.customerId));
      if (!walletSnap.exists) {
        throw new https.HttpsError("not-found", "Customer wallet not found");
      }

      // Float model: the agent pre-purchases e-money float, held apart from
      // their own wallet in agent:{uid} (AGENT_FLOAT_SEPARATION.md), and every
      // top-up is funded from it. Shop sales and commission can't be handed
      // out as cash-ins; the agent moves them into float first.
      const floatCents = await readFloatCents(agentId, tx);
      if (floatCents < topup.amount) {
        throw insufficientFloat(topup, floatCents);
      }

      // Agent float funds the customer's credit; commission is paid back to
      // the agent by the platform. Entry ID derives from the top-up request,
      // which completes exactly once.
      const lines: JournalLine[] = [
        { account: agentAccount(agentId), debit: topup.amount, credit: 0 },
        { account: userAccount(topup.customerId), debit: 0, credit: topup.amount },
      ];
      if (commissionCents > 0) {
        lines.push({ account: PLATFORM_FEES, debit: commissionCents, credit: 0 });
        lines.push({ account: userAccount(agentId), debit: 0, credit: commissionCents });
      }

      const pending = await prepareJournalEntry(tx, {
        entryId,
        type: "agent_topup",
        currency: topup.currency as "USD" | "SLS",
        lines,
        refs: { transactionId, topupId: topupRef.id },
        description: "Zapp agent top-up",
        postedBy: agentId,
      });

      pending.write(tx);

      // Transaction record
      const txRecord: Transaction = {
        type: "topup",
        kind: "cash_in",
        fromUserId: agentId,
        toUserId: topup.customerId,
        participants: [agentId, topup.customerId],
        amount: topup.amount,
        commissionCents,
        currency: topup.currency,
        status: "completed",
        description: "Zapp agent top-up",
        reference: confirmationId,
        journalEntryId: entryId,
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
      tx.update(topupRef, {
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
      {
        key: "topup.by_agent",
        params: {
          agent: agentData.fullName,
          amount: `${topup.currency} ${(topup.amount / 100).toFixed(2)}`,
        },
      },
      {
        type: "topup_completed",
        amount: topup.amount.toString(),
        currency: topup.currency,
        confirmationId,
      }
    ).catch((err) => console.error("Failed to notify customer:", err));

    // A first qualifying cash-in may unlock the customer's referral bonus.
    await maybeUnlockReferral(topup.customerId, { kind: "cash_in", amountCents: topup.amount });

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

import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { verifyUserPin } from "../auth/validatePin";
import { validateAmount, requireAuth, dollarsToCents } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { assertCashInRecipient } from "../utils/agentGuards";
import { enforcePerTransactionLimit } from "../utils/limits";
import { enforceVelocity } from "../utils/velocity";
import { isAgentRole } from "../utils/roles";
import { requireIdempotencyKey } from "../utils/idempotency";
import { notifyTopupCompleted } from "../utils/notifications";
import { maybeUnlockReferral } from "../referral/referralBonus";
import { readFloatCents } from "../agents/float";
import { ApiResponse, Transaction } from "../types";
import { getRates, computeCommission } from "../config/rates";
import { Currency, formatAmount, parseCurrency, toLimitCents } from "../utils/money";
import {
  prepareJournalEntry,
  userAccount,
  agentAccount,
  JournalLine,
  PLATFORM_FEES,
} from "../ledger";

/**
 * How the customer paid the agent. It is written into the customer's history
 * ("Manual top-up by agent (zaad)"), so it is one of these and never free
 * text from the agent's phone.
 */
export const TOPUP_PAYMENT_METHODS = ["cash", "zaad", "edahab", "bank_transfer"] as const;
export type TopupPaymentMethod = (typeof TOPUP_PAYMENT_METHODS)[number];

const MAX_REFERENCE_LENGTH = 64;
const MAX_NOTES_LENGTH = 280;

interface ManualTopupRequest {
  userId: string; // User to top up
  /** Whole units of `currency`: dollars (12.5), or whole shillings (30000). */
  amount: number;
  /**
   * "USD" (the default, and all older merchant builds send) or "SLS": the
   * agent's shilling float pays the customer's shilling balance, never
   * converted (SHILLINGS.md).
   */
  currency?: string;
  agentPin: string; // Agent's PIN for authorization
  paymentMethod: TopupPaymentMethod;
  reference?: string; // Optional reference number
  notes?: string; // Optional notes
  /**
   * Minted once per top-up by the agent's app and sent again on every retry
   * (utils/idempotency.ts). Without it a top-up whose reply was lost, then
   * retried, took the agent's float twice for cash they were paid once.
   * Optional only so merchant builds that predate it keep working.
   */
  idempotencyKey?: string;
}

interface ManualTopupResponse {
  transactionId: string;
  userId: string;
  amount: number;
  commission: number; // Agent commission earned, in dollars
  /** "USD" or "SLS": `amount` and `commission` are whole units of it. */
  currency?: string;
}

/**
 * A top-up's transaction id when the app sent a key: the same key from the
 * same agent always gives the same id, and nobody else's key can reach it.
 */
export function keyedTopupId(agentId: string, key: string): string {
  return crypto.createHash("sha256").update(`${agentId}:${key}`).digest("hex").slice(0, 24);
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > max) {
    throw new https.HttpsError("invalid-argument", `${field} must be at most ${max} characters`);
  }
  return value.trim();
}

/**
 * Callable function for agents to top up a customer found by phone number.
 * Used at physical top-up points (stores, kiosks, etc.), for cash or for
 * money the customer sent to the agent's own Zaad or eDahab.
 *
 * The reply never includes the customer's balance: an agent could otherwise
 * read anyone's by topping them up one cent.
 */
export const manualTopup = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ManualTopupRequest>
  ): Promise<ApiResponse<ManualTopupResponse>> => {
    // Validate authentication
    requireAuth(request);
    const agentId = request.auth!.uid;

    const data = request.data ?? ({} as ManualTopupRequest);
    const { userId, amount, agentPin } = data;
    const currency = parseCurrency(data.currency, "USD");
    if (!currency) {
      throw new https.HttpsError("invalid-argument", "Currency must be USD or SLS");
    }

    // Validate inputs
    if (typeof userId !== "string" || !userId || userId.includes("/")) {
      throw new https.HttpsError("invalid-argument", "User ID is required");
    }
    const paymentMethod: TopupPaymentMethod = data.paymentMethod ?? "cash";
    if (!TOPUP_PAYMENT_METHODS.includes(paymentMethod)) {
      throw new https.HttpsError("invalid-argument", "Unknown payment method");
    }
    const reference = optionalText(data.reference, "reference", MAX_REFERENCE_LENGTH);
    const notes = optionalText(data.notes, "notes", MAX_NOTES_LENGTH);
    // A key that is sent must be a usable one; only its absence means an
    // older build.
    const key =
      data.idempotencyKey === undefined ? null : requireIdempotencyKey(data.idempotencyKey);

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new https.HttpsError(
        "invalid-argument",
        "Amount must be greater than 0"
      );
    }

    // In the smallest unit: cents, or whole shillings.
    const amountCents = currency === "USD" ? dollarsToCents(amount) : amount;
    if (currency === "SLS" && !Number.isInteger(amount)) {
      throw new https.HttpsError("invalid-argument", "Shillings are whole numbers");
    }
    // The $1,000 cap is dollars; a shilling top-up counts at the limits rate.
    const { slsPerUsd } = await getRates();
    if (toLimitCents(amountCents, currency, slsPerUsd) > 100_000) {
      throw new https.HttpsError(
        "invalid-argument",
        "Maximum top-up amount is $1000 per transaction"
      );
    }

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

      // Only vetted agents hold float for cash-in. A plain merchant was never
      // approved to handle customers' cash; agentConfirmTopup and the
      // merchant app's dashboard already agree.
      if (!isAgentRole(agentData?.accountType)) {
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

      // With a key, the same top-up always has the same id. A retry of one
      // that already went through is answered with it here, before the
      // guards below: velocity already counts the first attempt, and the
      // float it spent may be what the agent was short of.
      const transactionId = key
        ? keyedTopupId(agentId, key)
        : db.collection("transactions").doc().id;
      const entryId = `manualtopup_${transactionId}`;
      if (key) {
        const sent = await db.collection("transactions").doc(transactionId).get();
        if (sent.exists) {
          return replayOf(sent.data() as Transaction, transactionId, agentId, userId, amountCents, currency);
        }
      }

      // Outgoing money waits out the pause after a PIN reset.
      await assertResetCooldownAllows(agentId, "other", 0);

      // Verify user exists
      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }
      const userData = userDoc.data();

      // Not the agent, not another agent or merchant, and not frozen: see
      // assertCashInRecipient for how each of those minted commission.
      assertCashInRecipient(agentId, userId, userData);

      // Cash-in is inbound for the customer, so only their per-transaction
      // ceiling applies — the same rule as customerRequestAgentTopup.
      await enforcePerTransactionLimit(amountCents, userData ?? {}, currency);

      // Every call pays commission, so how often an agent can call is a
      // control in its own right.
      await enforceVelocity(agentId);

      const { cashInCommissionRate } = await getRates();
      const commissionCents = computeCommission(amountCents, cashInCommissionRate);

      // Process top-up in a transaction. `posted` stays false when a parallel
      // retry with the same key got there first.
      let posted = false;

      await db.runTransaction(async (transaction) => {
        posted = false;
        // The row and the journal entry are written together, so the row
        // existing means this top-up is already done.
        const transactionRef = db.collection("transactions").doc(transactionId);
        if (key && (await transaction.get(transactionRef)).exists) return;

        // Get user wallet
        const walletRef = db.collection("wallets").doc(userId);
        const walletDoc = await transaction.get(walletRef);

        if (!walletDoc.exists) {
          throw new Error("User wallet not found");
        }

        // Float model: the top-up is funded from the agent's float, held apart
        // from their own wallet in agent:{uid} (AGENT_FLOAT_SEPARATION.md).
        // Float in the top-up's own currency: shillings from shilling float.
        const floatCents = await readFloatCents(agentId, transaction, currency);
        if (floatCents < amountCents) {
          throw new https.HttpsError(
            "failed-precondition",
            `Insufficient float. This top-up needs ${formatAmount(amountCents, currency)} but your float is ${formatAmount(floatCents, currency)}.`,
            { reason: "insufficient_float", floatCents }
          );
        }

        const now = admin.firestore.Timestamp.now();

        // Agent float funds the customer's credit; commission is credited
        // back to the agent, funded by the platform.
        const lines: JournalLine[] = [
          { account: agentAccount(agentId), debit: amountCents, credit: 0 },
          { account: userAccount(userId), debit: 0, credit: amountCents },
        ];
        if (commissionCents > 0) {
          lines.push({ account: PLATFORM_FEES, debit: commissionCents, credit: 0 });
          lines.push({ account: userAccount(agentId), debit: 0, credit: commissionCents });
        }

        const pending = await prepareJournalEntry(transaction, {
          entryId,
          type: "agent_topup",
          currency,
          lines,
          refs: { transactionId },
          description: `Manual top-up by agent (${paymentMethod})`,
          postedBy: agentId,
        });

        if (pending.alreadyPosted) return;
        pending.write(transaction);
        posted = true;

        // Create transaction record
        const txRecord: Transaction = {
          type: "topup",
          kind: "cash_in",
          fromUserId: agentId, // Agent who performed top-up
          toUserId: userId,
          participants: [agentId, userId],
          amount: amountCents,
          commissionCents,
          currency,
          status: "completed",
          description: `Manual top-up by agent (${paymentMethod})`,
          // Omitted when blank: Firestore rejects an undefined field, which
          // failed every manual top-up sent without a reference (INTERNAL).
          ...(reference ? { reference } : {}),
          journalEntryId: entryId,
          createdAt: now,
          completedAt: now,
        };

        transaction.set(transactionRef, txRecord);

        // Create manual top-up record for audit
        const topupRecord = {
          userId,
          agentId,
          amount: amountCents,
          amountDollars: amount,
          commissionCents,
          commissionDollars: currency === "USD" ? commissionCents / 100 : 0,
          currency,
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

      if (!posted) {
        const sent = await db.collection("transactions").doc(transactionId).get();
        return replayOf(sent.data() as Transaction, transactionId, agentId, userId, amountCents, currency);
      }

      // Send notification to user
      // The referral minimum is dollars; shillings count at the limits rate.
      await maybeUnlockReferral(userId, {
        kind: "cash_in",
        amountCents: toLimitCents(amountCents, currency, slsPerUsd),
      });

      notifyTopupCompleted(userId, amountCents, currency, paymentMethod).catch(
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
          commission: currency === "USD" ? commissionCents / 100 : commissionCents,
          currency,
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
 * The answer to a retry: the top-up the first attempt made, as long as it is
 * the same top-up. A key reused for a different customer or amount is a bug
 * in the caller, and saying "done" to it would tell the agent a top-up went
 * through that never did.
 */
function replayOf(
  sent: Transaction | undefined,
  transactionId: string,
  agentId: string,
  userId: string,
  amountCents: number,
  currency: Currency
): ApiResponse<ManualTopupResponse> {
  if (
    !sent ||
    sent.fromUserId !== agentId ||
    sent.toUserId !== userId ||
    sent.amount !== amountCents ||
    (parseCurrency(sent.currency) ?? "USD") !== currency
  ) {
    throw new https.HttpsError(
      "failed-precondition",
      "This top-up was already sent with different details. Start a new one.",
      { reason: "idempotency_mismatch" }
    );
  }
  return {
    success: true,
    data: {
      transactionId,
      userId,
      // Whole units, as the request sent them.
      amount: currency === "USD" ? amountCents / 100 : amountCents,
      commission: currency === "USD" ? (sent.commissionCents ?? 0) / 100 : sent.commissionCents ?? 0,
      currency,
    },
  };
}

/**
 * Get manual top-up history for an agent
 */
export const getAgentTopupHistory = https.onCall(
  { enforceAppCheck: true },
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

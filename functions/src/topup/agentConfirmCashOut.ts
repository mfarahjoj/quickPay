import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import { reserveOtpAttempt, clearOtpFailures } from "../utils/otpGuard";
import { notifyUser } from "../utils/notifications";
import { ApiResponse, CashOutRequest, Transaction, User } from "../types";
import { getRates, computeCommission } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  agentAccount,
  JournalLine,
  PLATFORM_FEES,
  CASHOUT_HOLD,
} from "../ledger";
import { releaseCashOutHold } from "./cashOutHold";
import { codesMatch, findPendingRequest, isSixDigitCode, normaliseCustomerPhone } from "./requestTarget";

// The cash-out tests and older imports reach it through this module.
export { normaliseCustomerPhone };

/** Code attempts against one request, from any agents; the last one wrong returns the money. */
export const MAX_CODE_ATTEMPTS_PER_REQUEST = 5;

/**
 * How many of those one agent may use. Fewer than the request's total, so a
 * single agent typing wrong codes (by mistake, or against a customer whose
 * phone number they know) can never be the one who locks the cash-out: the
 * customer can still be paid by any other agent.
 */
export const MAX_CODE_ATTEMPTS_PER_AGENT = 3;

interface AgentConfirmCashOutRequest {
  otpCode: string;
  agentPin: string;
  /** From the customer's QR. */
  cashOutId?: string;
  /** Typed by the agent when there is no QR: the customer's phone number. */
  customerPhone?: string;
}

interface AgentConfirmCashOutResponse {
  cashOutId: string;
  amount: number;
  customerName: string;
  commission: number;
  /** Set when the commission was withheld on a round trip. */
  commissionWithheld?: string;
}

const INVALID_CODE = "Invalid or expired code. Ask the customer to show their cash-out code again.";

/**
 * Agent claims a customer's cash-out and hands over the cash.
 *
 * The customer's money has been in platform:cashout_hold since they asked for
 * it. Every attempt here targets ONE request — scanned from the customer's QR
 * (cashOutId) or found by the customer's phone number — so wrong codes are
 * counted against that request whichever agents try them. That closes the
 * hole a bare 6-digit code leaves: colluding agents can no longer pool
 * guesses across every pending cash-out.
 *
 * Ledger: `cashout_{cashOutId}` — platform:cashout_hold → user:{agent}
 * (the agent's float grows by the cash they hand out), plus the commission
 * pair platform:fees → user:{agent}.
 */
/** True when this agent cashed this customer in at or after `sinceMs`. */
export async function cashedInWithAgentSince(
  db: FirebaseFirestore.Firestore,
  customerId: string,
  agentId: string,
  sinceMs: number
): Promise<boolean> {
  const snap = await db
    .collection("transactions")
    .where("toUserId", "==", customerId)
    .where("fromUserId", "==", agentId)
    .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(sinceMs))
    .limit(20)
    .get();
  return snap.docs.some((d) => {
    const t = d.data();
    return t.type === "topup" && t.status === "completed";
  });
}

export const agentConfirmCashOut = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<AgentConfirmCashOutRequest>
  ): Promise<ApiResponse<AgentConfirmCashOutResponse>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;
    const { otpCode, agentPin, cashOutId, customerPhone } = request.data ?? ({} as AgentConfirmCashOutRequest);

    if (!isSixDigitCode(otpCode)) {
      throw new https.HttpsError("invalid-argument", "6-digit code required");
    }
    if (!agentPin) {
      throw new https.HttpsError("invalid-argument", "Agent PIN is required");
    }
    if (!cashOutId && !customerPhone) {
      // A bare code is what made pooled guessing possible; older merchant
      // builds that send only the code must update.
      throw new https.HttpsError(
        "failed-precondition",
        "Scan the customer's cash-out QR, or enter their phone number with the code. Update Zapp Merchant if you can't."
      );
    }

    const db = admin.firestore();

    // Only vetted agents, who hold float, pay out cash.
    const agentDoc = await db.collection("users").doc(agentId).get();
    if (!agentDoc.exists) {
      throw new https.HttpsError("not-found", "Agent not found");
    }
    const agentData = agentDoc.data() as User;
    if (agentData.accountType !== "topup_agent" && agentData.accountType !== "agent_merchant") {
      throw new https.HttpsError("permission-denied", "Only agents can confirm cash-outs");
    }
    assertAccountActive(agentData);

    // The agent is claiming money: PIN, as on the top-up side.
    const pinValid = await verifyUserPin(agentId, agentPin);
    if (!pinValid) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }
    // Per-agent backstop on top of the per-request limit below, counted
    // before the lookup so parallel calls can't each slip a guess in.
    await reserveOtpAttempt(agentId);

    // Resolve the ONE request this attempt is about.
    const cashOutRef = await findPendingRequest(db, "cashOutRequests", {
      requestId: cashOutId,
      customerPhone,
    });
    const cashOutSnap = cashOutRef ? await cashOutRef.get() : null;
    const cashOut = cashOutSnap?.exists ? (cashOutSnap.data() as CashOutRequest) : null;
    if (!cashOutRef || !cashOut || cashOut.status !== "pending") {
      throw new https.HttpsError("not-found", INVALID_CODE);
    }

    // Count this attempt against the request *before* comparing. Counting
    // after let a burst of parallel guesses all compare before any of them
    // was recorded; reserved in a transaction, at most
    // MAX_CODE_ATTEMPTS_PER_REQUEST attempts ever reach the comparison, from
    // however many agents, and at most MAX_CODE_ATTEMPTS_PER_AGENT of them
    // from this one. Each is logged with who made it.
    const attempt = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(cashOutRef!)).data() as CashOutRequest | undefined;
      if (!fresh || fresh.status !== "pending") return { n: 0, agentLimit: false };
      const mine = (fresh.attemptsBy?.[agentId] ?? 0) + 1;
      if (mine > MAX_CODE_ATTEMPTS_PER_AGENT) return { n: 0, agentLimit: true };
      const n = (fresh.failedAttempts ?? 0) + 1;
      if (n > MAX_CODE_ATTEMPTS_PER_REQUEST) return { n: 0, agentLimit: false };
      tx.update(cashOutRef!, {
        failedAttempts: n,
        attemptsBy: { ...(fresh.attemptsBy ?? {}), [agentId]: mine },
        attemptLog: [...(fresh.attemptLog ?? []), { agentId, at: admin.firestore.Timestamp.now() }],
      });
      return { n, agentLimit: false };
    });
    if (attempt.agentLimit) {
      // This agent has had their tries at this cash-out; it stays open for
      // the customer to use elsewhere, or to cancel and start again.
      throw new https.HttpsError(
        "resource-exhausted",
        "Too many wrong codes for this cash-out. Ask the customer to cancel it and make a new one.",
        { reason: "agent_code_attempts" }
      );
    }
    if (attempt.n === 0) {
      throw new https.HttpsError("not-found", INVALID_CODE);
    }

    if (!codesMatch(otpCode, cashOut.otpCode)) {
      // The last allowed attempt was wrong: the money goes back.
      if (attempt.n >= MAX_CODE_ATTEMPTS_PER_REQUEST) {
        await releaseCashOutHold(cashOutRef.id, "too_many_attempts", "system");
      }
      throw new https.HttpsError("not-found", INVALID_CODE);
    }
    await clearOtpFailures(agentId);
    // A right code was not a guess. Give the attempt back, so an agent who
    // has to retry (a dropped connection after this point) can't run out of
    // tries, or use up the request's, with the correct code in hand.
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(cashOutRef)).data() as CashOutRequest | undefined;
      if (!fresh || fresh.status !== "pending") return;
      const mine = fresh.attemptsBy?.[agentId] ?? 0;
      tx.update(cashOutRef, {
        failedAttempts: Math.max(0, (fresh.failedAttempts ?? 0) - 1),
        attemptsBy: { ...(fresh.attemptsBy ?? {}), [agentId]: Math.max(0, mine - 1) },
      });
    });

    if (agentId === cashOut.customerId) {
      throw new https.HttpsError("permission-denied", "You cannot confirm your own cash-out");
    }

    if (new Date() > cashOut.expiresAt.toDate()) {
      await releaseCashOutHold(cashOutRef.id, "expired", "system");
      throw new https.HttpsError("failed-precondition", "This code has expired. The money has gone back to the customer.");
    }

    const customerDoc = await db.collection("users").doc(cashOut.customerId).get();
    // The funds already sit in the hold, so the debit here is against the hold,
    // not the wallet — a freeze applied after the request would otherwise let
    // the payout through.
    assertAccountActive(customerDoc.data(), "counterparty");
    const customerName = customerDoc.data()?.fullName || "Customer";

    const { cashOutCommissionRate, roundTripWindowHours } = await getRates();
    const feeCents = cashOut.feeCents ?? 0;
    // No commission on cash this customer cashed in with this same agent
    // within the window: otherwise the pair could loop the same money and
    // collect commission both ways (finding F1). The cash-out itself still
    // goes through; only Zapp's payment for it is withheld.
    const roundTrip =
      roundTripWindowHours > 0 &&
      (await cashedInWithAgentSince(db, cashOut.customerId, agentId, Date.now() - roundTripWindowHours * 3_600_000));
    const commissionCents = roundTrip ? 0 : computeCommission(cashOut.amount, cashOutCommissionRate);
    const now = admin.firestore.Timestamp.now();
    const entryId = `cashout_${cashOutRef.id}`;
    // Requests from before history rows existed get one written now.
    const transactionId = cashOut.transactionId ?? db.collection("transactions").doc().id;

    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(cashOutRef!)).data() as CashOutRequest;
      if (fresh.status !== "pending") {
        throw new https.HttpsError("failed-precondition", "Code already used");
      }

      const lines: JournalLine[] = [
        { account: CASHOUT_HOLD, debit: cashOut.amount + feeCents, credit: 0 },
        // The cash the agent handed over comes back to them as float.
        { account: agentAccount(agentId), debit: 0, credit: cashOut.amount },
      ];
      if (feeCents > 0) {
        lines.push({ account: PLATFORM_FEES, debit: 0, credit: feeCents });
      }
      if (commissionCents > 0) {
        lines.push({ account: PLATFORM_FEES, debit: commissionCents, credit: 0 });
        lines.push({ account: userAccount(agentId), debit: 0, credit: commissionCents });
      }

      const pending = await prepareJournalEntry(tx, {
        entryId,
        type: "agent_cashout",
        currency: cashOut.currency as "USD" | "SLS",
        lines,
        refs: { transactionId, topupId: cashOutRef!.id },
        description: "Agent cash-out",
        postedBy: agentId,
      });
      pending.write(tx);

      tx.update(cashOutRef!, { status: "completed", agentId, completedAt: now });

      const settled: Partial<Transaction> = {
        toUserId: agentId,
        participants: [cashOut.customerId, agentId],
        commissionCents,
        ...(roundTrip ? { commissionWithheld: "round_trip" as const } : {}),
        status: "completed",
        description: "Agent cash-out",
        journalEntryId: entryId,
        holdEntryId: `cashouthold_${cashOutRef!.id}`,
        completedAt: now,
      };
      const txRef = db.collection("transactions").doc(transactionId);
      if (cashOut.transactionId) {
        tx.update(txRef, settled);
      } else {
        tx.set(txRef, {
          type: "withdrawal",
          kind: "cash_out",
          fromUserId: cashOut.customerId,
          amount: cashOut.amount,
          currency: cashOut.currency,
          createdAt: now,
          ...settled,
        } as Transaction);
      }
    });

    notifyUser(
      cashOut.customerId,
      "cashout_completed",
      {
        key: "cashout.paid_by_agent",
        params: {
          agent: agentData.fullName,
          amount: `${cashOut.currency} ${(cashOut.amount / 100).toFixed(2)}`,
        },
      },
      { type: "cashout_complete", transactionId }
    ).catch((err) => console.error("Failed to notify customer:", err));

    return {
      success: true,
      data: {
        cashOutId: cashOutRef.id,
        amount: cashOut.amount,
        customerName,
        commission: commissionCents,
        ...(roundTrip ? { commissionWithheld: "round_trip" } : {}),
      },
    };
  }
);

import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { assertAccountActive } from "../utils/accountStatus";
import { verifyUserPin } from "../auth/validatePin";
import {
  assertNotOtpLocked,
  recordOtpFailure,
  clearOtpFailures,
} from "../utils/otpGuard";
import { notifyUser } from "../utils/notifications";
import { ApiResponse, CashOutRequest, Transaction, User } from "../types";
import { getRates, computeCommission } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
  CASHOUT_HOLD,
} from "../ledger";
import { releaseCashOutHold } from "./cashOutHold";

/** Wrong codes against one request, from any agents, before it locks and the money goes back. */
export const MAX_CODE_ATTEMPTS_PER_REQUEST = 5;

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
}

/** "+252634…", "0634…", "634…", "00252…" → "+252634…". Other countries need their "+". */
export function normaliseCustomerPhone(raw: string): string | null {
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (!digits) return null;
  let e164: string;
  if (t.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith("252")) e164 = `+${digits}`;
  else e164 = `+252${digits.replace(/^0/, "")}`;
  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}

function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
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
export const agentConfirmCashOut = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<AgentConfirmCashOutRequest>
  ): Promise<ApiResponse<AgentConfirmCashOutResponse>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;
    const { otpCode, agentPin, cashOutId, customerPhone } = request.data ?? ({} as AgentConfirmCashOutRequest);

    if (typeof otpCode !== "string" || !/^\d{6}$/.test(otpCode)) {
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
    // Per-agent backstop on top of the per-request limit below.
    assertNotOtpLocked(agentData);

    // Resolve the ONE request this attempt is about.
    let cashOutRef: FirebaseFirestore.DocumentReference | null = null;
    if (typeof cashOutId === "string" && cashOutId && !cashOutId.includes("/")) {
      cashOutRef = db.collection("cashOutRequests").doc(cashOutId);
    } else if (typeof customerPhone === "string") {
      const phone = normaliseCustomerPhone(customerPhone);
      if (phone) {
        const users = await db.collection("users").where("phoneNumber", "==", phone).limit(1).get();
        if (!users.empty) {
          const pending = await db
            .collection("cashOutRequests")
            .where("customerId", "==", users.docs[0].id)
            .where("status", "==", "pending")
            .limit(1)
            .get();
          if (!pending.empty) cashOutRef = pending.docs[0].ref;
        }
      }
    }
    const cashOutSnap = cashOutRef ? await cashOutRef.get() : null;
    const cashOut = cashOutSnap?.exists ? (cashOutSnap.data() as CashOutRequest) : null;
    if (!cashOutRef || !cashOut || cashOut.status !== "pending") {
      await recordOtpFailure(agentId, agentData);
      throw new https.HttpsError("not-found", INVALID_CODE);
    }

    if (!codesMatch(otpCode, cashOut.otpCode)) {
      await recordOtpFailure(agentId, agentData);
      // Count it against the request; the fifth wrong code returns the money.
      const attempts = await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(cashOutRef!)).data() as CashOutRequest;
        if (fresh.status !== "pending") return 0;
        const n = (fresh.failedAttempts ?? 0) + 1;
        tx.update(cashOutRef!, { failedAttempts: n });
        return n;
      });
      if (attempts >= MAX_CODE_ATTEMPTS_PER_REQUEST) {
        await releaseCashOutHold(cashOutRef.id, "too_many_attempts", "system");
      }
      throw new https.HttpsError("not-found", INVALID_CODE);
    }
    await clearOtpFailures(agentId, agentData);

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

    const { topupCommissionRate } = await getRates();
    const commissionCents = computeCommission(cashOut.amount, topupCommissionRate);
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
        { account: CASHOUT_HOLD, debit: cashOut.amount, credit: 0 },
        { account: userAccount(agentId), debit: 0, credit: cashOut.amount },
      ];
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
      "Cash Out Complete",
      `${agentData.fullName} paid out your cash-out of ${cashOut.currency} ${(cashOut.amount / 100).toFixed(2)}`,
      { type: "cashout_complete", transactionId }
    ).catch((err) => console.error("Failed to notify customer:", err));

    return {
      success: true,
      data: {
        cashOutId: cashOutRef.id,
        amount: cashOut.amount,
        customerName,
        commission: commissionCents,
      },
    };
  }
);

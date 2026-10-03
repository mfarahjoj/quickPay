import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { assertResetCooldownAllows } from "../utils/resetCooldown";
import { requireAuth, validateAmount } from "../utils/validation";
import { requireActiveAccount } from "../utils/accountStatus";
import { enforceTransactionLimits } from "../utils/limits";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import { ApiResponse, Wallet, CashOutRequest, Transaction } from "../types";
import { prepareJournalEntry, userAccount, CASHOUT_HOLD } from "../ledger";
import { releaseCashOutHold } from "./cashOutHold";

const CASHOUT_EXPIRY_MINUTES = 30;
const MIN_CASHOUT_CENTS = 100; // $1 minimum

interface CustomerCashOutRequest {
  amount: number; // In cents
  pin: string;
}

interface CustomerCashOutResponse {
  cashOutId: string;
  otpCode: string;
  amount: number;
  expiresAt: string;
}

function generateOTP(): string {
  // crypto-secure: Math.random() output can be predicted from observations,
  // and this code is what releases the customer's money to an agent.
  return crypto.randomInt(100000, 1000000).toString();
}

export const customerCashOut = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<CustomerCashOutRequest>
  ): Promise<ApiResponse<CustomerCashOutResponse>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;

    const { amount, pin } = request.data;

    if (!validateAmount(amount) || amount < MIN_CASHOUT_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `Minimum cash-out is $${MIN_CASHOUT_CENTS / 100}`
      );
    }

    const pinValid = await verifyUserPin(customerId, pin);
    if (!pinValid) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    // Outgoing money waits out the pause after a PIN reset.
    await assertResetCooldownAllows(customerId, "other", 0);

    const customerData = await requireActiveAccount(customerId);

    await enforceTransactionLimits(customerId, amount, customerData);

    await enforceVelocity(customerId);

    const db = admin.firestore();
    const walletRef = db.collection("wallets").doc(customerId);
    const walletDoc = await walletRef.get();

    if (!walletDoc.exists) {
      throw new https.HttpsError("not-found", "Wallet not found");
    }

    const wallet = walletDoc.data() as Wallet;
    if (wallet.balance < amount) {
      throw new https.HttpsError("failed-precondition", "Insufficient balance");
    }

    // One live cash-out per customer: a new request returns any older held
    // money first (through the same path as cancel and expiry).
    const existing = await db
      .collection("cashOutRequests")
      .where("customerId", "==", customerId)
      .where("status", "==", "pending")
      .get();
    for (const doc of existing.docs) {
      await releaseCashOutHold(doc.id, "replaced", customerId);
    }

    const now = admin.firestore.Timestamp.now();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + CASHOUT_EXPIRY_MINUTES);

    const otpCode = generateOTP();
    const cashOutRef = db.collection("cashOutRequests").doc();
    // The customer's history shows the held money straight away as a pending
    // cash-out, rather than a balance that silently dropped.
    const transactionId = db.collection("transactions").doc().id;
    const holdEntryId = `cashouthold_${cashOutRef.id}`;

    const cashOutRecord: CashOutRequest = {
      customerId,
      amount,
      currency: wallet.currency,
      otpCode,
      status: "pending",
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt: now,
      transactionId,
      failedAttempts: 0,
    };

    // Deduct balance immediately into the cash-out hold — released to the
    // agent's float on confirm, or back to the customer on cancel/expiry.
    await db.runTransaction(async (tx) => {
      const pending = await prepareJournalEntry(tx, {
        entryId: holdEntryId,
        type: "agent_cashout",
        currency: wallet.currency as "USD" | "SLS",
        lines: [
          { account: userAccount(customerId), debit: amount, credit: 0 },
          { account: CASHOUT_HOLD, debit: 0, credit: amount },
        ],
        refs: { topupId: cashOutRef.id, transactionId },
        description: "Cash-out hold",
        postedBy: customerId,
      });
      pending.write(tx);
      tx.set(cashOutRef, cashOutRecord);
      // toUserId is filled in by the agent who claims it.
      const txRecord: Transaction = {
        type: "withdrawal",
        fromUserId: customerId,
        toUserId: "",
        participants: [customerId],
        amount,
        currency: wallet.currency,
        status: "pending",
        description: "Cash-out — show your code to an agent",
        journalEntryId: holdEntryId,
        holdEntryId,
        createdAt: now,
      };
      tx.set(db.collection("transactions").doc(transactionId), txRecord);
    });

    return {
      success: true,
      data: {
        cashOutId: cashOutRef.id,
        otpCode,
        amount,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }
);

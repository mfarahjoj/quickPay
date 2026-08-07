import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, validateAmount } from "../utils/validation";
import { requireActiveAccount } from "../utils/accountStatus";
import { enforceTransactionLimits } from "../utils/limits";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import { ApiResponse, Wallet, CashOutRequest } from "../types";
import { prepareJournalEntry, userAccount, CASHOUT_HOLD } from "../ledger";

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
  return Math.floor(100000 + Math.random() * 900000).toString();
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

    // Cancel any existing pending cash-out for this customer, returning each
    // held amount from platform:cashout_hold to their wallet.
    const existing = await db
      .collection("cashOutRequests")
      .where("customerId", "==", customerId)
      .where("status", "==", "pending")
      .get();
    for (const doc of existing.docs) {
      const held = doc.data() as CashOutRequest;
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(doc.ref)).data() as CashOutRequest;
        if (fresh.status !== "pending") return;
        const pending = await prepareJournalEntry(tx, {
          entryId: `cashoutrelease_${doc.id}`,
          type: "adjustment",
          currency: held.currency as "USD" | "SLS",
          lines: [
            { account: CASHOUT_HOLD, debit: held.amount, credit: 0 },
            { account: userAccount(customerId), debit: 0, credit: held.amount },
          ],
          refs: { topupId: doc.id },
          description: "Cash-out cancelled — hold returned",
          postedBy: customerId,
        });
        pending.write(tx);
        tx.update(doc.ref, { status: "cancelled" });
      });
    }

    const now = admin.firestore.Timestamp.now();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + CASHOUT_EXPIRY_MINUTES);

    const otpCode = generateOTP();
    const cashOutRef = db.collection("cashOutRequests").doc();

    const cashOutRecord: CashOutRequest = {
      customerId,
      amount,
      currency: wallet.currency,
      otpCode,
      status: "pending",
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdAt: now,
    };

    // Deduct balance immediately into the cash-out hold — released to the
    // agent's float on confirm, or back to the customer on cancel/expiry.
    await db.runTransaction(async (tx) => {
      const pending = await prepareJournalEntry(tx, {
        entryId: `cashouthold_${cashOutRef.id}`,
        type: "agent_cashout",
        currency: wallet.currency as "USD" | "SLS",
        lines: [
          { account: userAccount(customerId), debit: amount, credit: 0 },
          { account: CASHOUT_HOLD, debit: 0, credit: amount },
        ],
        refs: { topupId: cashOutRef.id },
        description: "Cash-out hold",
        postedBy: customerId,
      });
      pending.write(tx);
      tx.set(cashOutRef, cashOutRecord);
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

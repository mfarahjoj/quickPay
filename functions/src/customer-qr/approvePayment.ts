import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { requireActiveAccount } from "../utils/accountStatus";
import { enforceTransactionLimits } from "../utils/limits";
import { verifyUserPin } from "../auth/validatePin";
import { enforceVelocity } from "../utils/velocity";
import {
  notifyPaymentReceived,
  notifyPaymentSent,
} from "../utils/notifications";
import {
  ApiResponse,
  MerchantPaymentRequest,
  Transaction,
} from "../types";
import { getRates, computePaymentFee } from "../config/rates";
import {
  prepareJournalEntry,
  userAccount,
  JournalLine,
  PLATFORM_FEES,
} from "../ledger";
import { requestExpiryMillis } from "./requestExpiry";

interface ApprovePaymentInput {
  requestId: string;
  pin: string;
  /**
   * The amount the customer was shown, in cents. When sent, the approval is
   * refused unless it matches the request — the customer pays what they saw
   * or nothing. Optional so builds that predate it keep working.
   */
  expectedAmount?: number;
}

interface ApprovePaymentResponse {
  transactionId: string;
  amount: number;
}

export const approvePaymentRequest = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ApprovePaymentInput>
  ): Promise<ApiResponse<ApprovePaymentResponse>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;

    const { requestId, pin, expectedAmount } = request.data;

    if (!requestId || !pin) {
      throw new https.HttpsError(
        "invalid-argument",
        "Request ID and PIN are required"
      );
    }
    if (
      expectedAmount !== undefined &&
      (typeof expectedAmount !== "number" || !Number.isInteger(expectedAmount))
    ) {
      throw new https.HttpsError(
        "invalid-argument",
        "expectedAmount must be whole cents"
      );
    }

    const db = admin.firestore();

    const pinValid = await verifyUserPin(customerId, pin);
    if (!pinValid) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }

    const requestPreCheck = await db
      .collection("paymentRequests")
      .doc(requestId)
      .get();
    const preRequest = requestPreCheck.exists
      ? (requestPreCheck.data() as MerchantPaymentRequest)
      : undefined;

    // A retry after the first approval's reply was lost. The payment went
    // through, so answer with it: an error here tells the customer it failed,
    // and they pay again another way. Answered before velocity and limits,
    // which already count this payment and would refuse the retry for it.
    if (
      preRequest &&
      preRequest.customerId === customerId &&
      preRequest.status === "approved"
    ) {
      return {
        success: true,
        data: {
          transactionId:
            preRequest.transactionId ?? (await findTransactionId(db, requestId)),
          amount: preRequest.amount,
        },
      };
    }

    const customerData = await requireActiveAccount(customerId);

    await enforceVelocity(customerId);

    // Limits are checked against the requested amount before posting. The
    // transaction below re-reads the request as the authoritative copy.
    if (preRequest) {
      await enforceTransactionLimits(
        customerId,
        preRequest.amount ?? 0,
        customerData
      );
    }

    const { paymentFeeRate } = await getRates();

    const transactionId = db.collection("transactions").doc().id;
    let replayedTransactionId: string | undefined;
    let approvedAmount: number;
    let approvedCurrency: string;
    let approvedMerchantId: string;
    let approvedReference: string | undefined;
    let feeCents = 0;
    let netCents = 0;

    const requestRef = db.collection("paymentRequests").doc(requestId);

    let lapsed = false;

    await db.runTransaction(async (tx) => {
      lapsed = false;
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) {
        throw new https.HttpsError("not-found", "Payment request not found");
      }

      const paymentReq = requestSnap.data() as MerchantPaymentRequest;

      if (paymentReq.customerId !== customerId) {
        throw new https.HttpsError(
          "permission-denied",
          "This request is not for you"
        );
      }

      if (paymentReq.status !== "pending") {
        throw new https.HttpsError(
          "failed-precondition",
          `Request is already ${paymentReq.status}`
        );
      }

      if (Date.now() > requestExpiryMillis(paymentReq)) {
        // Record the expiry, then refuse once the transaction has committed:
        // throwing in here would roll the write back and leave the request
        // reading "pending" to both apps for good.
        tx.update(requestRef, {
          status: "expired",
          resolvedAt: admin.firestore.Timestamp.now(),
        });
        lapsed = true;
        return;
      }

      if (expectedAmount !== undefined && expectedAmount !== paymentReq.amount) {
        throw new https.HttpsError(
          "failed-precondition",
          "The amount of this request does not match what was shown"
        );
      }

      approvedAmount = paymentReq.amount;
      approvedCurrency = paymentReq.currency;
      approvedMerchantId = paymentReq.merchantId;
      approvedReference = paymentReq.reference;

      // Merchant absorbs the platform fee and receives the net.
      feeCents = computePaymentFee(approvedAmount, paymentFeeRate);
      netCents = approvedAmount - feeCents;

      const lines: JournalLine[] = [
        { account: userAccount(customerId), debit: approvedAmount, credit: 0 },
        { account: userAccount(approvedMerchantId), debit: 0, credit: netCents },
      ];
      if (feeCents > 0) {
        lines.push({ account: PLATFORM_FEES, debit: 0, credit: feeCents });
      }

      // Entry ID derives from the payment request, which resolves exactly once.
      const pending = await prepareJournalEntry(tx, {
        entryId: `custqr_${requestId}`,
        type: "customer_qr_payment",
        currency: approvedCurrency as "USD" | "SLS",
        lines,
        refs: { transactionId },
        description: "QR Payment (Customer Token)",
        postedBy: customerId,
      });

      const now = admin.firestore.Timestamp.now();

      if (pending.alreadyPosted) {
        // The entry exists but the request still reads pending — the two are
        // written together, so this should not happen. Settle the request on
        // the transaction that entry names rather than write a second row.
        const entrySnap = await tx.get(
          db.collection("journal_entries").doc(`custqr_${requestId}`)
        );
        const postedTxId = entrySnap.data()?.refs?.transactionId as string | undefined;
        tx.update(requestRef, {
          status: "approved",
          resolvedAt: now,
          ...(postedTxId ? { transactionId: postedTxId } : {}),
        });
        replayedTransactionId = postedTxId ?? "";
        return;
      }

      pending.write(tx);

      const txRecord: Transaction = {
        type: "payment",
        fromUserId: customerId,
        toUserId: approvedMerchantId,
        participants: [customerId, approvedMerchantId],
        amount: approvedAmount,
        feeCents,
        netCents,
        currency: approvedCurrency,
        status: "completed",
        description: "QR Payment (Customer Token)",
        ...(approvedReference ? { reference: approvedReference } : {}),
        journalEntryId: `custqr_${requestId}`,
        createdAt: now,
        completedAt: now,
      };

      tx.set(db.collection("transactions").doc(transactionId), txRecord);

      tx.update(requestRef, {
        status: "approved",
        resolvedAt: now,
        transactionId,
      });
    });

    if (lapsed) {
      throw new https.HttpsError(
        "failed-precondition",
        "Payment request has expired"
      );
    }

    if (replayedTransactionId !== undefined) {
      return {
        success: true,
        data: { transactionId: replayedTransactionId, amount: approvedAmount! },
      };
    }

    notifyPaymentReceived(
      approvedMerchantId!,
      netCents,
      approvedCurrency!,
      customerId
    ).catch((err) => console.error("Failed to notify merchant:", err));

    notifyPaymentSent(
      customerId,
      approvedAmount!,
      approvedCurrency!,
      approvedMerchantId!
    ).catch((err) => console.error("Failed to notify customer:", err));

    return {
      success: true,
      data: {
        transactionId,
        amount: approvedAmount!,
      },
    };
  }
);

/**
 * The transaction behind an approval made before requests recorded it. The
 * row carries the journal entry ID, which is derived from the request.
 */
async function findTransactionId(
  db: FirebaseFirestore.Firestore,
  requestId: string
): Promise<string> {
  const snap = await db
    .collection("transactions")
    .where("journalEntryId", "==", `custqr_${requestId}`)
    .limit(1)
    .get();
  return snap.empty ? "" : snap.docs[0].id;
}

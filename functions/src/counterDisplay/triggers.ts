/**
 * Keeping counter displays in step with the money functions without
 * touching them.
 *
 * processPayment, payMerchant and approvePaymentRequest are unchanged. Each
 * already writes a document these triggers can see: the sale's QR turns
 * `used`, a request turns `approved`, a My QR payment creates a
 * `transactions` row. Each trigger re-derives the shop's state
 * (state.ts) and adds a short flash for what just happened.
 *
 * A flash is timed from the source doc (usedAt, resolvedAt, createdAt), so a
 * redelivered event can't stretch it. Shops with no display cost one query.
 */

import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { MerchantPaymentRequest, QRCode, Transaction } from "../types";
import { makeFlash, syncCounterState, toMillis } from "./state";
import { StateFlash } from "./types";

/** Pure: the flash a QR change calls for, if any. */
export function flashForQr(before: QRCode | undefined, after: QRCode | undefined): StateFlash | undefined {
  if (before?.status === "active" && after?.status === "used") {
    return makeFlash(
      "paid",
      after.paidAmount ?? after.amount,
      toMillis(after.usedAt, Date.now()),
      after.receiptNumber
    );
  }
  return undefined;
}

/** Pure: the flash a payment request change calls for, if any. */
export function flashForRequest(
  before: (MerchantPaymentRequest & { receiptNumber?: string }) | undefined,
  after: (MerchantPaymentRequest & { receiptNumber?: string }) | undefined
): StateFlash | undefined {
  if (!after || before?.status !== "pending" || after.status === "pending") return undefined;
  if (after.purpose === "cash_out") return undefined;
  const at = toMillis(after.resolvedAt, Date.now());
  switch (after.status) {
    case "approved":
      return makeFlash("paid", after.amount, at, after.receiptNumber);
    case "rejected":
      return makeFlash("declined", after.amount, at);
    case "expired":
      return makeFlash("expired", after.amount, at);
    default:
      // Cancelled by the cashier: they know; the screen just moves on.
      return undefined;
  }
}

/**
 * Pure: a My QR payment (payMerchant), the one kind of sale with no QR doc or
 * request to watch. The other payments are flashed by the triggers above.
 */
export function flashForTransaction(tx: Transaction | undefined): { merchantId: string; flash: StateFlash } | undefined {
  if (!tx || tx.kind !== "merchant_payment" || tx.type !== "payment" || tx.status !== "completed") return undefined;
  if (typeof tx.journalEntryId !== "string" || !tx.journalEntryId.startsWith("paymerchant")) return undefined;
  if (typeof tx.toUserId !== "string") return undefined;
  return {
    merchantId: tx.toUserId,
    flash: makeFlash("paid", tx.amount, toMillis(tx.createdAt, Date.now()), tx.receiptNumber),
  };
}

export const counterDisplayOnQrCode = onDocumentWritten("qrCodes/{qrCodeId}", async (event) => {
  const before = event.data?.before.data() as QRCode | undefined;
  const after = event.data?.after.data() as QRCode | undefined;
  const merchantId = after?.merchantId ?? before?.merchantId;
  if (!merchantId) return;
  await syncCounterState(merchantId, { flash: flashForQr(before, after) });
});

export const counterDisplayOnPaymentRequest = onDocumentWritten(
  "paymentRequests/{requestId}",
  async (event) => {
    const before = event.data?.before.data() as MerchantPaymentRequest | undefined;
    const after = event.data?.after.data() as MerchantPaymentRequest | undefined;
    const merchantId = after?.merchantId ?? before?.merchantId;
    if (!merchantId) return;
    if ((after ?? before)?.purpose === "cash_out") return;
    await syncCounterState(merchantId, { flash: flashForRequest(before, after) });
  }
);

export const counterDisplayOnTransaction = onDocumentCreated("transactions/{transactionId}", async (event) => {
  const hit = flashForTransaction(event.data?.data() as Transaction | undefined);
  if (!hit) return;
  await syncCounterState(hit.merchantId, { flash: hit.flash });
});

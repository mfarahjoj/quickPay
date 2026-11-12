import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";

/**
 * What each merchant has already been paid for, keyed by the sale's reference
 * (usually the invoice number off their till). It exists for one question,
 * asked before a payment code is shown: "has this invoice been paid
 * already?" — so a busy counter doesn't charge the same bill twice.
 *
 * One doc per merchant and reference, overwritten by each payment that
 * carries it, written in the payment's own Firestore transaction. Server-only:
 * the default-deny rule covers it.
 */

export const PAID_REFERENCES = "paidReferences";

// Letters and digits in any script. Built from a string because the compile
// target predates regex-literal Unicode property escapes; Node runs it fine.
const NON_WORD = new RegExp("[^\\p{L}\\p{N}]+", "u");
/**
 * Server-side bound only. The merchant app caps references at 40; this is
 * looser so an older build with an uncapped field isn't suddenly refused.
 */
export const REFERENCE_MAX_LENGTH = 80;

/**
 * Words that label a number rather than identify a sale, dropped from the
 * front of a reference so the same invoice matches however it was entered:
 * "Invoice No 37841", "INVOICE NO.:37841" and "37841" are one invoice.
 */
const LABEL_WORDS = new Set([
  "invoice", "inv", "receipt", "rcpt", "bill", "order", "ticket", "check", "chk",
  "transaction", "trans", "txn", "trx", "reference", "ref", "voucher", "docket",
  "folio", "slip", "serial", "no", "num", "number", "nbr", "nr", "id",
]);

/** Stable matching key for a reference, or null when nothing usable is left. */
export function referenceKey(reference: string): string | null {
  if (typeof reference !== "string") return null;
  const tokens = reference
    .toLowerCase()
    .split(NON_WORD)
    .filter(Boolean);
  let start = 0;
  // Keep at least the last token: a reference of only "Invoice" stays itself.
  while (start < tokens.length - 1 && LABEL_WORDS.has(tokens[start])) start++;
  const key = tokens.slice(start).join("");
  return key ? key.slice(0, 80) : null;
}

/**
 * Trim and bound a client-supplied reference. Undefined when there is none;
 * throws invalid-argument for anything that isn't a short string.
 */
export function cleanReference(reference: unknown): string | undefined {
  if (reference === undefined || reference === null) return undefined;
  if (typeof reference !== "string") {
    throw new https.HttpsError("invalid-argument", "Reference must be text");
  }
  const trimmed = reference.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > REFERENCE_MAX_LENGTH) {
    throw new https.HttpsError(
      "invalid-argument",
      `Reference must be at most ${REFERENCE_MAX_LENGTH} characters`
    );
  }
  return trimmed;
}

function markerRef(db: FirebaseFirestore.Firestore, merchantId: string, key: string) {
  return db.collection(PAID_REFERENCES).doc(`${merchantId}_${key}`);
}

export interface PaidReferenceRecord {
  merchantId: string;
  reference: string;
  transactionId: string;
  receiptNumber: string;
  amount: number;
  currency: string;
  paidByName: string | null;
}

/** The slice of a Firestore transaction this module needs. */
export interface MarkerTx {
  set(
    ref: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.DocumentData,
    options: FirebaseFirestore.SetOptions
  ): unknown;
}

/**
 * Note that `reference` has been paid. A write only, with no read, so it can
 * go anywhere among the payment transaction's writes.
 */
export function recordPaidReference(
  tx: MarkerTx,
  db: FirebaseFirestore.Firestore,
  record: PaidReferenceRecord
): void {
  const key = referenceKey(record.reference);
  if (!key) return;
  tx.set(
    markerRef(db, record.merchantId, key),
    {
      ...record,
      key,
      paidAt: admin.firestore.Timestamp.now(),
      count: admin.firestore.FieldValue.increment(1),
    },
    { merge: true }
  );
}

/** What the merchant is shown when they are about to charge a paid reference. */
export interface PriorPayment {
  reference: string;
  receiptNumber: string;
  amount: number;
  currency: string;
  paidByName: string | null;
  /** ISO timestamp, so it survives the trip through HttpsError details. */
  paidAt: string;
  /** How many payments have carried this reference. */
  count: number;
}

/**
 * The last payment that carried `reference` for this merchant, or null when
 * it has never been paid — or when that payment was refunded, since charging
 * a refunded invoice again is the normal thing to do.
 */
export async function findPaidReference(
  db: FirebaseFirestore.Firestore,
  merchantId: string,
  reference: string
): Promise<PriorPayment | null> {
  const key = referenceKey(reference);
  if (!key) return null;

  const marker = await markerRef(db, merchantId, key).get();
  if (!marker.exists) return null;
  const data = marker.data() as PaidReferenceRecord & {
    paidAt?: FirebaseFirestore.Timestamp;
    count?: number;
  };

  const payment = await db.collection("transactions").doc(data.transactionId).get();
  if (!payment.exists || payment.data()?.refundedAt) return null;

  return {
    reference: data.reference,
    receiptNumber: data.receiptNumber,
    amount: data.amount,
    currency: data.currency,
    paidByName: data.paidByName ?? null,
    paidAt: (data.paidAt ?? payment.data()?.createdAt)?.toDate?.().toISOString() ?? "",
    count: data.count ?? 1,
  };
}

/**
 * Refuse to raise a charge for a reference that's already been paid, unless
 * the merchant has seen the warning and said to go ahead. Runs only when the
 * client asks for it: references like "Table 4" repeat all day by design, and
 * only the merchant's app knows which references are meant to be unique.
 */
export async function guardPaidReference(
  db: FirebaseFirestore.Firestore,
  merchantId: string,
  reference: string | undefined,
  options: { check?: unknown; confirmed?: unknown }
): Promise<void> {
  if (!reference || options.check !== true || options.confirmed === true) return;
  const prior = await findPaidReference(db, merchantId, reference);
  if (!prior) return;
  throw new https.HttpsError(
    "already-exists",
    "This reference has already been paid",
    { priorPayment: prior }
  );
}

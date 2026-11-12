import * as crypto from "crypto";
import * as admin from "firebase-admin";

/**
 * Zapp receipt numbers, e.g. "ZP-7K3M-9QX2".
 *
 * Every merchant payment and refund gets one. It is what the customer and the
 * merchant read out to each other, write on a paper receipt, or give support
 * — the 20-character transaction id is unique but nobody can say it aloud.
 *
 * Eight Crockford base32 characters: no I, L, O or U, so nothing printed can
 * be misread, and lookups forgive the usual slips (O for 0, I or L for 1).
 * 32^8 is about 1.1 trillion, and every number is reserved in
 * `receiptNumbers/{number}` inside the same Firestore transaction as the
 * payment, so uniqueness is guaranteed, not just likely. Random rather than
 * sequential on purpose: a platform-wide counter would put every payment in
 * Somaliland behind one hot document, and would publish our volume on every
 * receipt.
 */

export const RECEIPT_NUMBERS = "receiptNumbers";
export const RECEIPT_PREFIX = "ZP";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LENGTH = 8;
const MAX_ATTEMPTS = 5;

type RandomInt = (max: number) => number;
const secureRandomInt: RandomInt = (max) => crypto.randomInt(max);

function format(body: string): string {
  return `${RECEIPT_PREFIX}-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function generateReceiptNumber(randomInt: RandomInt = secureRandomInt): string {
  let body = "";
  for (let i = 0; i < BODY_LENGTH; i++) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return format(body);
}

/**
 * Turn whatever a person typed or read out into the canonical form, or null
 * when it can't be a receipt number. "zp 7k3m 9qx2", "7K3M-9QX2" and
 * "ZP 7K3M 9QX2" all work; so does an O typed for a 0.
 */
export function normalizeReceiptNumber(input: string): string | null {
  if (typeof input !== "string") return null;
  let compact = input.toUpperCase().replace(/[\s\-_.]/g, "");
  if (compact.length === BODY_LENGTH + RECEIPT_PREFIX.length && compact.startsWith(RECEIPT_PREFIX)) {
    compact = compact.slice(RECEIPT_PREFIX.length);
  }
  if (compact.length !== BODY_LENGTH) return null;

  const body = compact.replace(/O/g, "0").replace(/[IL]/g, "1");
  for (const ch of body) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return format(body);
}

/** The slice of a Firestore transaction this module needs. */
export interface ReceiptTx {
  get(ref: FirebaseFirestore.DocumentReference): Promise<{ exists: boolean }>;
  create(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData): unknown;
}

/**
 * Pick a receipt number nobody holds. This is a transaction READ, so call it
 * before the transaction's first write — at the top of the callback is
 * simplest. Pair it with `reserveReceiptNumber` later in the same callback.
 */
export async function claimReceiptNumber(
  tx: ReceiptTx,
  db: FirebaseFirestore.Firestore,
  randomInt: RandomInt = secureRandomInt
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateReceiptNumber(randomInt);
    const snap = await tx.get(db.collection(RECEIPT_NUMBERS).doc(candidate));
    if (!snap.exists) return candidate;
  }
  // Five misses in a trillion-wide space means the generator is broken, not
  // unlucky. Fail the payment rather than issue a number twice.
  throw new Error("Could not allocate a receipt number");
}

export interface ReceiptRecord {
  transactionId: string;
  type: string;
  participants: string[];
  amount: number;
  currency: string;
}

/**
 * Write the reservation, which doubles as the lookup index from a receipt
 * number to its transaction. `create` fails the whole transaction if the
 * number was taken after the claim read it, so a race can't share a number.
 */
export function reserveReceiptNumber(
  tx: ReceiptTx,
  db: FirebaseFirestore.Firestore,
  receiptNumber: string,
  record: ReceiptRecord
): void {
  tx.create(db.collection(RECEIPT_NUMBERS).doc(receiptNumber), {
    ...record,
    createdAt: admin.firestore.Timestamp.now(),
  });
}

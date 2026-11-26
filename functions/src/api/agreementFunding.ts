/**
 * Whether a customer has added money to Zapp, for partners' agreements.
 *
 * Ridy lets a driver keep driving only once they have linked Zapp and added
 * money to it at least once. Zapp tells the partner only that, never the
 * balance: `customer_topped_up` on the agreement, and the webhook
 * `agreement.topped_up`, once (webhooks.ts).
 *
 * "Added money" is any completed top-up transaction to the customer: agent
 * cash, a mobile-money or Zaad top-up, a remittance. The first one stamps
 * `users/{uid}.firstCashInAt` and copies it onto the customer's active
 * agreements; approving an agreement copies it too (approveApiAgreement.ts).
 * Accounts that topped up before the stamp existed are found from their
 * transactions, once.
 *
 * Nothing here moves money.
 */

import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { API_AGREEMENTS_COLLECTION, ApiAgreement } from "./types";

type Ts = FirebaseFirestore.Timestamp;

interface TopupFields {
  type?: string;
  status?: string;
  toUserId?: string;
  createdAt?: Ts;
  completedAt?: Ts;
}

/**
 * The customer a transaction write tops up, or null unless it is a top-up
 * that has just completed. Pure.
 */
export function toppedUpCustomer(before: TopupFields | undefined, after: TopupFields | undefined): string | null {
  if (!after || after.type !== "topup" || after.status !== "completed") return null;
  if (before?.type === "topup" && before.status === "completed") return null;
  return typeof after.toUserId === "string" && after.toUserId ? after.toUserId : null;
}

/**
 * When [uid] first added money, or null if they never have. A customer who
 * topped up before the stamp existed is stamped from their history here.
 */
export async function firstCashInAt(uid: string): Promise<Ts | null> {
  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const user = await userRef.get();
  if (!user.exists) return null;
  const stamped = user.data()?.firstCashInAt as Ts | undefined;
  if (stamped) return stamped;
  const past = await db
    .collection("transactions")
    .where("toUserId", "==", uid)
    .where("type", "==", "topup")
    .where("status", "==", "completed")
    .orderBy("createdAt")
    .limit(1)
    .get();
  if (past.empty) return null;
  const t = past.docs[0].data() as TopupFields;
  const at = t.completedAt ?? t.createdAt ?? admin.firestore.Timestamp.now();
  await recordCashIn(uid, at);
  return at;
}

/**
 * Stamp [uid]'s first top-up at [at], once, and tell their agreements in
 * force. A later top-up changes nothing.
 */
export async function recordCashIn(uid: string, at: Ts): Promise<void> {
  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const stampedNow = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists || snap.data()?.firstCashInAt) return false;
    tx.update(userRef, { firstCashInAt: at });
    return true;
  });
  if (!stampedNow) return;
  // An agreement approved from here on reads the stamp in its own
  // transaction, so between them none is missed.
  const active = await db
    .collection(API_AGREEMENTS_COLLECTION)
    .where("customerId", "==", uid)
    .where("status", "==", "active")
    .get();
  await Promise.all(
    active.docs
      .filter((d) => !(d.data() as ApiAgreement).customerToppedUpAt)
      .map((d) => d.ref.update({ customerToppedUpAt: at }))
  );
}

export const agreementFundingOnTransaction = onDocumentWritten("transactions/{transactionId}", async (event) => {
  const before = event.data?.before.data() as TopupFields | undefined;
  const after = event.data?.after.data() as TopupFields | undefined;
  const uid = toppedUpCustomer(before, after);
  if (!uid || !after) return;
  await recordCashIn(uid, after.completedAt ?? after.createdAt ?? admin.firestore.Timestamp.now());
});

import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "../admin/guard";
import { stageAuditEntry } from "../admin/audit";
import { prepareJournalEntry } from "../ledger";
import { encrypt } from "../utils/encryption";
import { notifyTopupCompleted } from "../utils/notifications";
import { Transaction } from "../types";
import { Provider, assignEntry, isProvider, refundEntry } from "./core";
import { RECEIPTS } from "./receipts";
import { ENCRYPTION_KEY, PIN_PEPPER } from "../config/secrets";

export const LISTENER_DEVICES = "listener_devices";

const OPS = ["ops", "super"] as const;

/** Console: held payments, newest first. */
export const adminListHeldMobileMoney = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAdmin(request, [...OPS]);
  const snap = await admin.firestore().collection(RECEIPTS)
    .where("status", "==", "held").limit(200).get();
  const rows = snap.docs.map((d) => {
    const r = d.data();
    return {
      receiptId: d.id,
      provider: r.provider,
      operatorTxnId: r.operatorTxnId,
      amountCents: r.amountCents,
      currency: r.currency,
      senderMsisdn: r.senderMsisdn,
      senderName: r.senderName ?? null,
      reason: r.reason,
      suggestedUid: r.suggestedUid ?? null,
      receivedAt: r.receivedAt?.toMillis?.() ?? null,
    };
  }).sort((a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0));
  return { success: true, data: rows };
});

/** Console: give a held payment to the customer it belongs to. */
export const adminAssignMobileMoney = https.onCall({ enforceAppCheck: true }, async (request) => {
  const actor = requireAdmin(request, [...OPS]);
  requireRecentAdminAuth(request);
  const reason = requireReason(request.data?.reason);
  const receiptId = String(request.data?.receiptId ?? "");
  const uid = String(request.data?.uid ?? "");
  if (!receiptId || !uid) throw new https.HttpsError("invalid-argument", "receiptId and uid are required");

  const db = admin.firestore();
  const ref = db.collection(RECEIPTS).doc(receiptId);
  const transactionId = db.collection("transactions").doc().id;
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new https.HttpsError("not-found", "No such payment");
    const r = snap.data()!;
    if (r.status !== "held") throw new https.HttpsError("failed-precondition", `This payment is already ${r.status}`);
    if (r.currency !== "USD") throw new https.HttpsError("failed-precondition", "Only dollar payments can be credited for now");
    const userSnap = await tx.get(db.collection("users").doc(uid));
    if (!userSnap.exists) throw new https.HttpsError("not-found", "No such customer");

    const entry = assignEntry(receiptId, r.amountCents, uid, actor.uid, transactionId);
    const prepared = await prepareJournalEntry(tx, entry);
    prepared.write(tx);
    const now = admin.firestore.Timestamp.now();
    tx.set(db.collection("transactions").doc(transactionId), {
      type: "topup",
      kind: "mobile_money_topup",
      fromUserId: r.provider,
      toUserId: uid,
      participants: [uid],
      amount: r.amountCents,
      currency: r.currency,
      status: "completed",
      description: `${r.provider === "zaad" ? "Zaad" : "eDahab"} top-up`,
      reference: r.operatorTxnId,
      journalEntryId: entry.entryId,
      createdAt: now,
      completedAt: now,
    } as Transaction);
    tx.update(ref, { status: "assigned", uid, transactionId, assignedBy: actor.uid, assignedAt: now, assignEntryId: entry.entryId });
    stageAuditEntry(tx, {
      actor,
      action: "mobile_money.assign",
      target: { type: "mobile_money_receipt", id: receiptId },
      reason,
      before: { status: "held" },
      after: { status: "assigned", uid, amountCents: r.amountCents },
      journalEntryId: entry.entryId,
    });
    return { amountCents: r.amountCents as number, currency: r.currency as string, provider: r.provider as string };
  });
  await notifyTopupCompleted(uid, result.amountCents, result.currency, result.provider)
    .catch((e) => console.error("mobile money: notify failed", e));
  return { success: true, data: { receiptId, uid, transactionId } };
});

/**
 * Console: the held payment was sent back to the sender from the collection
 * SIM. [reference] is the operator's ID for that send.
 */
export const adminRefundMobileMoney = https.onCall({ enforceAppCheck: true }, async (request) => {
  const actor = requireAdmin(request, [...OPS]);
  requireRecentAdminAuth(request);
  const reason = requireReason(request.data?.reason);
  const receiptId = String(request.data?.receiptId ?? "");
  const reference = String(request.data?.reference ?? "").trim();
  if (!receiptId) throw new https.HttpsError("invalid-argument", "receiptId is required");
  if (reference.length < 3) throw new https.HttpsError("invalid-argument", "Enter the transaction ID of the send back");

  const db = admin.firestore();
  const ref = db.collection(RECEIPTS).doc(receiptId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new https.HttpsError("not-found", "No such payment");
    const r = snap.data()!;
    if (r.status !== "held") throw new https.HttpsError("failed-precondition", `This payment is already ${r.status}`);
    const entry = refundEntry(receiptId, r.provider as Provider, r.amountCents, actor.uid);
    const prepared = await prepareJournalEntry(tx, entry);
    prepared.write(tx);
    const now = admin.firestore.Timestamp.now();
    tx.update(ref, { status: "refunded", refundReference: reference, refundedBy: actor.uid, refundedAt: now, refundEntryId: entry.entryId });
    stageAuditEntry(tx, {
      actor,
      action: "mobile_money.refund",
      target: { type: "mobile_money_receipt", id: receiptId },
      reason,
      before: { status: "held" },
      after: { status: "refunded", reference, amountCents: r.amountCents },
      journalEntryId: entry.entryId,
    });
  });
  return { success: true, data: { receiptId } };
});

/**
 * Console (super only): register the phone that holds a collection SIM.
 * Returns its signing key ONCE; the listener app stores it and signs every
 * SMS it forwards. Registering again replaces the key.
 */
export const adminRegisterListener = https.onCall({ enforceAppCheck: true, secrets: [ENCRYPTION_KEY, PIN_PEPPER] }, async (request) => {
  const actor = requireAdmin(request, "super");
  requireRecentAdminAuth(request);
  const provider = request.data?.provider;
  if (!isProvider(provider)) throw new https.HttpsError("invalid-argument", "Choose zaad or edahab");
  const label = String(request.data?.label ?? "").trim().slice(0, 60) || `${provider} listener`;
  const deviceId = `ld_${crypto.randomBytes(9).toString("base64url")}`;
  const key = crypto.randomBytes(32).toString("base64url");
  const db = admin.firestore();
  await db.runTransaction(async (tx) => {
    tx.set(db.collection(LISTENER_DEVICES).doc(deviceId), {
      provider,
      label,
      keyEncrypted: encrypt(key),
      active: true,
      createdBy: actor.uid,
      createdAt: admin.firestore.Timestamp.now(),
      lastSeenAt: null,
    });
    stageAuditEntry(tx, {
      actor,
      action: "listener.register",
      target: { type: "mobile_money_receipt", id: deviceId },
      reason: `Registered ${label}`,
      after: { provider, label },
    });
  });
  return { success: true, data: { deviceId, key, provider, label } };
});

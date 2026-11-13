import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "../admin/guard";
import { stageAuditEntry } from "../admin/audit";
import { prepareJournalEntry } from "../ledger";
import { encrypt } from "../utils/encryption";
import { notifyTopupCompleted } from "../utils/notifications";
import { Transaction } from "../types";
import { paymentCurrency, Provider, assignEntry, assignFloatEntry, isProvider, normaliseSomaliMsisdn, refundEntry } from "./core";
import { isAgentRole } from "../utils/roles";
import { LISTENER_DEVICES, LISTENER_SMS, RECEIPTS } from "./receipts";
import { COLLECTION_CONFIG } from "./linking";
import { ENCRYPTION_KEY, PIN_PEPPER } from "../config/secrets";

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
    const currency = paymentCurrency(r as { currency: string });
    if (!currency) throw new https.HttpsError("failed-precondition", `Zapp can't hold ${r.currency}`);
    const userSnap = await tx.get(db.collection("users").doc(uid));
    if (!userSnap.exists) throw new https.HttpsError("not-found", "No such customer");
    // Money from an agent buys float, as it would have if it had matched.
    const forFloat = isAgentRole(userSnap.get("accountType"));
    if (forFloat && currency !== "USD") {
      throw new https.HttpsError("failed-precondition", "Agents' float is in dollars only for now. Send it back instead.");
    }

    const entry = forFloat
      ? assignFloatEntry(receiptId, r.amountCents, currency, uid, actor.uid, transactionId)
      : assignEntry(receiptId, r.amountCents, currency, uid, actor.uid, transactionId);
    const prepared = await prepareJournalEntry(tx, entry);
    prepared.write(tx);
    const now = admin.firestore.Timestamp.now();
    tx.set(db.collection("transactions").doc(transactionId), {
      type: "topup",
      kind: forFloat ? "float" : "mobile_money_topup",
      fromUserId: r.provider,
      toUserId: uid,
      participants: [uid],
      amount: r.amountCents,
      currency,
      status: "completed",
      description: forFloat
        ? `Float bought with ${r.provider === "zaad" ? "Zaad" : "eDahab"}`
        : `${r.provider === "zaad" ? "Zaad" : "eDahab"} top-up`,
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
      after: { status: "assigned", uid, amountCents: r.amountCents, ...(forFloat ? { creditedTo: "float" } : {}) },
      journalEntryId: entry.entryId,
    });
    return { amountCents: r.amountCents as number, currency, provider: r.provider as string };
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
    const currency = paymentCurrency(r as { currency: string });
    if (!currency) throw new https.HttpsError("failed-precondition", `Zapp can't hold ${r.currency}`);
    const entry = refundEntry(receiptId, r.provider as Provider, r.amountCents, currency, actor.uid);
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

/** Console: listener phones and when each last checked in. */
export const adminListListeners = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAdmin(request, [...OPS]);
  const snap = await admin.firestore().collection(LISTENER_DEVICES).get();
  const rows = snap.docs.map((d) => ({
    deviceId: d.id,
    provider: d.get("provider"),
    label: d.get("label"),
    active: d.get("active") === true,
    lastSeenAt: d.get("lastSeenAt")?.toMillis?.() ?? null,
    createdAt: d.get("createdAt")?.toMillis?.() ?? null,
  }));
  return { success: true, data: rows };
});

/**
 * Console: texts the listener forwarded that didn't become a payment —
 * unparsed (the reader doesn't know the wording), failed, or ignored (not
 * from an operator sender ID) — newest first.
 */
export const adminListListenerSms = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAdmin(request, [...OPS]);
  const wanted = ["unparsed", "failed", "ignored"];
  const status = wanted.includes(request.data?.status) ? request.data.status : "unparsed";
  const snap = await admin.firestore().collection(LISTENER_SMS)
    .where("status", "==", status).limit(100).get();
  const rows = snap.docs.map((d) => ({
    id: d.id,
    provider: d.get("provider"),
    from: d.get("from"),
    body: d.get("body"),
    status: d.get("status"),
    receivedAt: d.get("receivedAt")?.toMillis?.() ?? null,
  })).sort((a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0));
  return { success: true, data: rows };
});

export interface CollectionEntry {
  number: string | null;
  active: boolean;
  senderIds: string[];
}

/**
 * Validates an admin's change to one provider's collection settings.
 * Returns what to store, or throws with the reason.
 */
export function collectionUpdate(input: unknown): CollectionEntry {
  const i = (input ?? {}) as Record<string, unknown>;
  const number = i.number == null || i.number === "" ? null : normaliseSomaliMsisdn(String(i.number));
  if (i.number != null && i.number !== "" && !number) {
    throw new https.HttpsError("invalid-argument", "Enter the collection number like 063 412 3456");
  }
  const raw = Array.isArray(i.senderIds) ? i.senderIds : String(i.senderIds ?? "").split(",");
  const senderIds = [...new Set(raw.map((s) => String(s).trim()).filter((s) => s.length > 0 && s.length <= 20))];
  if (senderIds.length > 5) throw new https.HttpsError("invalid-argument", "At most five sender IDs");
  const active = i.active === true;
  if (active && !number) throw new https.HttpsError("invalid-argument", "Set the number before switching top-ups on");
  if (active && senderIds.length === 0) {
    throw new https.HttpsError("invalid-argument", "Add the operator's sender ID before switching top-ups on");
  }
  return { number, active, senderIds };
}

/** Console: the collection numbers and their operators' sender IDs. */
export const adminGetCollection = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAdmin(request, [...OPS]);
  const snap = await admin.firestore().doc(COLLECTION_CONFIG).get();
  const read = (p: Provider): CollectionEntry => {
    const e = snap.exists ? snap.get(p) : null;
    return {
      number: e?.number ?? null,
      active: e?.active === true,
      senderIds: Array.isArray(e?.senderIds) ? e.senderIds : [],
    };
  };
  return { success: true, data: { zaad: read("zaad"), edahab: read("edahab") } };
});

/**
 * Console (super only): set a provider's collection number, sender IDs, and
 * whether customers can top up through it.
 */
export const adminUpdateCollection = https.onCall({ enforceAppCheck: true }, async (request) => {
  const actor = requireAdmin(request, "super");
  requireRecentAdminAuth(request);
  const reason = requireReason(request.data?.reason);
  const provider = request.data?.provider;
  if (!isProvider(provider)) throw new https.HttpsError("invalid-argument", "Choose zaad or edahab");
  const entry = collectionUpdate(request.data);
  const db = admin.firestore();
  const ref = db.doc(COLLECTION_CONFIG);
  await db.runTransaction(async (tx) => {
    const before = (await tx.get(ref)).get(provider) ?? null;
    tx.set(ref, { [provider]: entry }, { merge: true });
    stageAuditEntry(tx, {
      actor,
      action: "collection.update",
      target: { type: "mobile_money_receipt", id: `collection_${provider}` },
      reason,
      before: before ?? {},
      after: { ...entry },
    });
  });
  return { success: true, data: entry };
});

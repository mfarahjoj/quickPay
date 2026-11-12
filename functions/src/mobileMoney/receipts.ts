import * as admin from "firebase-admin";
import { prepareJournalEntry, WalletNotFoundError } from "../ledger";
import { getRates, Rates } from "../config/rates";
import { isAgentRole } from "../utils/roles";
import { notifyTopupCompleted } from "../utils/notifications";
import { Transaction } from "../types";
import {
  Decision,
  LinkedNumber,
  ReceivedPayment,
  decideReceipt,
  floatEntry,
  limitsFor,
  linkId,
  receiptId,
  suspenseEntry,
  topupEntry,
} from "./core";

export const RECEIPTS = "mobile_money_receipts";
export const LINKED_NUMBERS = "linked_numbers";
/** Listener phones (adminDesk.ts) and the texts they forwarded (listener.ts). */
export const LISTENER_DEVICES = "listener_devices";
export const LISTENER_SMS = "listener_sms";

export type ReceiptStatus = "credited" | "held" | "assigned" | "refunded";

export interface ReceiptOutcome {
  receiptId: string;
  status: ReceiptStatus;
  uid: string | null;
  reason: string | null;
  duplicate: boolean;
}

/**
 * Credits (or holds) one payment the collection number received. Safe to call
 * any number of times for the same operator transaction: the receipt doc and
 * the journal entry are both keyed by it.
 */
export async function processReceipt(payment: ReceivedPayment): Promise<ReceiptOutcome> {
  const rates = await getRates();
  try {
    return await post(payment, rates, null);
  } catch (error) {
    // The linked customer has no wallet (never finished sign-up): hold it.
    if (error instanceof WalletNotFoundError) {
      return post(payment, rates, { action: "suspense", reason: "no_wallet", uid: null });
    }
    throw error;
  }
}

async function post(
  payment: ReceivedPayment,
  rates: Rates,
  forced: Decision | null
): Promise<ReceiptOutcome> {
  const db = admin.firestore();
  const id = receiptId(payment.provider, payment.operatorTxnId);
  const receiptRef = db.collection(RECEIPTS).doc(id);
  const linkRef = db.collection(LINKED_NUMBERS).doc(linkId(payment.provider, payment.senderMsisdn));
  const transactionId = db.collection("transactions").doc().id;

  const outcome = await db.runTransaction(async (tx): Promise<ReceiptOutcome & { notify: boolean }> => {
    const existing = await tx.get(receiptRef);
    if (existing.exists) {
      const r = existing.data()!;
      return {
        receiptId: id, status: r.status, uid: r.uid ?? null, reason: r.reason ?? null,
        duplicate: true, notify: false,
      };
    }
    const linkSnap = await tx.get(linkRef);
    const link = linkSnap.exists ? (linkSnap.data() as LinkedNumber) : null;
    // An agent's own number buys them float rather than topping up their
    // wallet, under the agents' float limit. Read now, so a role granted or
    // removed since the number was linked is what counts.
    const owner = link ? (await tx.get(db.collection("users").doc(link.uid))).data() : undefined;
    const forFloat = isAgentRole(owner?.accountType);
    const decision = forced ?? decideReceipt(payment, link, limitsFor(rates, forFloat));
    const now = admin.firestore.Timestamp.now();
    const base = {
      provider: payment.provider,
      operatorTxnId: payment.operatorTxnId,
      amountCents: payment.amountCents,
      currency: payment.currency,
      senderMsisdn: payment.senderMsisdn,
      senderName: payment.senderName,
      receivedAt: admin.firestore.Timestamp.fromMillis(payment.receivedAtMs),
      createdAt: now,
    };

    if (decision.action === "suspense") {
      const prepared = await prepareJournalEntry(tx, suspenseEntry(payment));
      prepared.write(tx);
      tx.create(receiptRef, {
        ...base,
        status: "held",
        reason: decision.reason,
        // Who it probably belongs to, for the admin.
        suggestedUid: decision.uid,
        uid: null,
        journalEntryId: suspenseEntry(payment).entryId,
      });
      return { receiptId: id, status: "held", uid: null, reason: decision.reason, duplicate: false, notify: false };
    }

    const entry = forFloat
      ? floatEntry(payment, decision.uid, transactionId)
      : topupEntry(payment, decision.uid, transactionId);
    const prepared = await prepareJournalEntry(tx, entry);
    prepared.write(tx);
    const label = payment.provider === "zaad" ? "Zaad" : "eDahab";
    const row: Transaction = {
      type: "topup",
      kind: forFloat ? "float" : "mobile_money_topup",
      fromUserId: payment.provider,
      toUserId: decision.uid,
      participants: [decision.uid],
      amount: payment.amountCents,
      currency: payment.currency,
      status: "completed",
      description: decision.action === "activate"
        ? `${label} number linked`
        : forFloat
          ? `Float bought with ${label}`
          : `${label} top-up`,
      reference: payment.operatorTxnId,
      journalEntryId: entry.entryId,
      createdAt: now,
      completedAt: now,
    } as Transaction;
    tx.set(db.collection("transactions").doc(transactionId), row);
    tx.create(receiptRef, {
      ...base,
      status: "credited",
      reason: decision.action === "activate" ? "activation" : null,
      uid: decision.uid,
      ...(forFloat ? { creditedTo: "float" } : {}),
      transactionId,
      journalEntryId: entry.entryId,
    });
    if (decision.action === "activate") {
      tx.update(linkRef, { status: "verified", verifiedAt: now, verifiedBy: id });
      tx.set(
        db.collection("users").doc(decision.uid),
        { linkedAccounts: { [`${payment.provider}Phone`]: payment.senderMsisdn, [`${payment.provider}Verified`]: true } },
        { merge: true }
      );
    }
    return { receiptId: id, status: "credited", uid: decision.uid, reason: null, duplicate: false, notify: true };
  });

  if (outcome.notify && outcome.uid) {
    await notifyTopupCompleted(outcome.uid, payment.amountCents, payment.currency, payment.provider)
      .catch((e) => console.error("mobile money: notify failed", e));
  }
  const { notify: _notify, ...result } = outcome;
  return result;
}

/**
 * Zaad / eDahab top-ups through Zapp's own collection number, without an
 * operator API (ZAPP_TOPUP_AND_RIDY_COMMISSION_PLAN.md in the Ridy repo, M1).
 *
 * A customer sends money from their linked number to Zapp's collection
 * number. The phone holding that SIM (the listener) forwards the operator's
 * "you received" SMS; it is parsed into a [ReceivedPayment] and matched to
 * the customer by the sender's number:
 *
 *   sender has a pending link   → activation: the link becomes verified and
 *                                 the amount is credited, whatever it is
 *   sender has a verified link  → credited, if within the top-up limits
 *   anything else               → held in platform:mm_suspense until an
 *                                 admin assigns it or refunds the sender
 *
 * When the linked account is an agent's, "credited" means their float
 * (agent:{uid}), not their wallet: that is how an agent buys float with Zaad
 * instead of a trip to ops (floatEntry below). Agents have their own, larger
 * limit (`agentFloatTopupMaxCents`).
 *
 * Every movement is one journal entry keyed by the operator's transaction ID,
 * so the same SMS can never credit twice. This file is pure: no Firestore.
 */

import { JournalEntryInput, JournalLine } from "../ledger";
import { agentAccount, mobileMoneyFloat, userAccount, MOBILE_MONEY_SUSPENSE } from "../ledger/accounts";

export type Provider = "zaad" | "edahab";
export const PROVIDERS: readonly Provider[] = ["zaad", "edahab"];

export function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

/** A payment the collection number received, as read from the operator's SMS. */
export interface ReceivedPayment {
  provider: Provider;
  /** The operator's transaction ID — the idempotency key. */
  operatorTxnId: string;
  amountCents: number;
  currency: string;
  /** E.164, e.g. +252634123456. */
  senderMsisdn: string;
  senderName: string | null;
  receivedAtMs: number;
}

/** linked_numbers/{provider}_{msisdn} */
export interface LinkedNumber {
  uid: string;
  provider: Provider;
  msisdn: string;
  status: "pending" | "verified";
}

export interface TopupLimits {
  topupMinCents: number;
  topupMaxCents: number;
}

export type SuspenseReason =
  | "unknown_sender"
  | "below_min"
  | "above_max"
  | "currency"
  | "no_wallet";

export type Decision =
  | { action: "credit"; uid: string }
  | { action: "activate"; uid: string }
  | { action: "suspense"; reason: SuspenseReason; uid: string | null };

// Shared with the Zaad account every user gives (auth/zaadAccount.ts).
export { normaliseSomaliMsisdn } from "../utils/msisdn";

export function linkId(provider: Provider, msisdn: string): string {
  return `${provider}_${msisdn.replace(/^\+/, "")}`;
}

/** One receipt per operator transaction. */
export function receiptId(provider: Provider, operatorTxnId: string): string {
  const safe = operatorTxnId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) throw new Error("operatorTxnId has no usable characters");
  return `${provider}_${safe}`;
}

/** What to do with a payment from [link] (null: nobody has linked the sender). */
export function decideReceipt(
  payment: Pick<ReceivedPayment, "amountCents" | "currency">,
  link: LinkedNumber | null,
  limits: TopupLimits
): Decision {
  if (!link) return { action: "suspense", reason: "unknown_sender", uid: null };
  // Until shilling wallets exist (M4), only dollars are credited.
  if (payment.currency !== "USD") return { action: "suspense", reason: "currency", uid: link.uid };
  if (link.status === "pending") return { action: "activate", uid: link.uid };
  if (payment.amountCents < limits.topupMinCents) {
    return { action: "suspense", reason: "below_min", uid: link.uid };
  }
  if (payment.amountCents > limits.topupMaxCents) {
    return { action: "suspense", reason: "above_max", uid: link.uid };
  }
  return { action: "credit", uid: link.uid };
}

// --------------------------------------------------------------- templates

function entry(
  entryId: string,
  type: JournalEntryInput["type"],
  lines: JournalLine[],
  description: string,
  postedBy: string,
  refs: JournalEntryInput["refs"]
): JournalEntryInput {
  return { entryId, type, currency: "USD", lines, description, postedBy, refs };
}

/** Real money reached the collection number and is the customer's. */
export function topupEntry(p: ReceivedPayment, uid: string, transactionId: string): JournalEntryInput {
  return entry(
    `mmtopup_${receiptId(p.provider, p.operatorTxnId)}`,
    "mobile_money_topup",
    [
      { account: mobileMoneyFloat(p.provider), debit: p.amountCents, credit: 0 },
      { account: userAccount(uid), debit: 0, credit: p.amountCents },
    ],
    `${p.provider === "zaad" ? "Zaad" : "eDahab"} top-up`,
    "system",
    { transactionId, receiptId: receiptId(p.provider, p.operatorTxnId) }
  );
}

/**
 * Real money reached the collection number from an agent's own number: it
 * buys them float. The same accounts as the ops float desk's issue
 * (float:{provider} → agent:{uid}), backed by money Zapp now holds.
 */
export function floatEntry(p: ReceivedPayment, uid: string, transactionId: string): JournalEntryInput {
  return entry(
    `mmfloat_${receiptId(p.provider, p.operatorTxnId)}`,
    "float_issue",
    [
      { account: mobileMoneyFloat(p.provider), debit: p.amountCents, credit: 0 },
      { account: agentAccount(uid), debit: 0, credit: p.amountCents },
    ],
    `Float bought with ${p.provider === "zaad" ? "Zaad" : "eDahab"}`,
    "system",
    { transactionId, receiptId: receiptId(p.provider, p.operatorTxnId) }
  );
}

/** An admin gives a held payment to the agent it came from, as float. */
export function assignFloatEntry(
  receipt: string,
  amountCents: number,
  uid: string,
  adminUid: string,
  transactionId: string
): JournalEntryInput {
  return entry(
    `mmassignfloat_${receipt}`,
    "float_issue",
    [
      { account: MOBILE_MONEY_SUSPENSE, debit: amountCents, credit: 0 },
      { account: agentAccount(uid), debit: 0, credit: amountCents },
    ],
    "Float bought with mobile money, matched by Zapp",
    adminUid,
    { transactionId, receiptId: receipt }
  );
}

/** The limits that apply to a payment for an agent's float, or a customer's wallet. */
export function limitsFor(
  rates: { topupMinCents: number; topupMaxCents: number; agentFloatTopupMaxCents: number },
  forFloat: boolean
): TopupLimits {
  return {
    topupMinCents: rates.topupMinCents,
    topupMaxCents: forFloat ? rates.agentFloatTopupMaxCents : rates.topupMaxCents,
  };
}

/** Real money arrived that can't be credited yet: held, never dropped. */
export function suspenseEntry(p: ReceivedPayment): JournalEntryInput {
  return entry(
    `mmsuspense_${receiptId(p.provider, p.operatorTxnId)}`,
    "mobile_money_suspense",
    [
      { account: mobileMoneyFloat(p.provider), debit: p.amountCents, credit: 0 },
      { account: MOBILE_MONEY_SUSPENSE, debit: 0, credit: p.amountCents },
    ],
    "Unmatched mobile money held for review",
    "system",
    { receiptId: receiptId(p.provider, p.operatorTxnId) }
  );
}

/** An admin gives a held payment to the customer it belongs to. */
export function assignEntry(
  receipt: string,
  amountCents: number,
  uid: string,
  adminUid: string,
  transactionId: string
): JournalEntryInput {
  return entry(
    `mmassign_${receipt}`,
    "mobile_money_assign",
    [
      { account: MOBILE_MONEY_SUSPENSE, debit: amountCents, credit: 0 },
      { account: userAccount(uid), debit: 0, credit: amountCents },
    ],
    "Mobile money top-up, matched by Zapp",
    adminUid,
    { transactionId, receiptId: receipt }
  );
}

/** An admin sent a held payment back to the sender from the collection SIM. */
export function refundEntry(
  receipt: string,
  provider: Provider,
  amountCents: number,
  adminUid: string
): JournalEntryInput {
  return entry(
    `mmrefund_${receipt}`,
    "mobile_money_refund",
    [
      { account: MOBILE_MONEY_SUSPENSE, debit: amountCents, credit: 0 },
      { account: mobileMoneyFloat(provider), debit: 0, credit: amountCents },
    ],
    "Unmatched mobile money returned to the sender",
    adminUid,
    { receiptId: receipt }
  );
}

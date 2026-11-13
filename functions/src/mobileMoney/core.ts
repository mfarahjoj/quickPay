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

import { JournalEntryInput, JournalLine, LedgerCurrency } from "../ledger";
import { agentAccount, mobileMoneyFloat, userAccount, MOBILE_MONEY_SUSPENSE } from "../ledger/accounts";
import { currencyFromApiCode, toLimitCents } from "../utils/money";

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
  /** In the currency's smallest unit: cents, or whole shillings. */
  amountCents: number;
  /** As the operator writes it: "USD" or "SLSH". */
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

/** Limits are in US cents; a shilling payment is compared at `slsPerUsd`. */
export interface TopupLimits {
  topupMinCents: number;
  topupMaxCents: number;
  slsPerUsd: number;
  /** Whether shillings can be credited (not yet to an agent's float). */
  shillings: boolean;
}

/** The ledger currency of a payment, or null for one Zapp doesn't hold. */
export function paymentCurrency(p: Pick<ReceivedPayment, "currency">): LedgerCurrency | null {
  return currencyFromApiCode(p.currency);
}

function requireCurrency(p: Pick<ReceivedPayment, "currency">): LedgerCurrency {
  const currency = paymentCurrency(p);
  if (!currency) throw new Error(`Unsupported currency ${p.currency}`);
  return currency;
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
  // Shillings go to the wallet's shilling pocket. Agents' float is dollars
  // only until agents cash in and out in shillings.
  const currency = paymentCurrency(payment);
  if (!currency || (currency === "SLS" && !limits.shillings)) {
    return { action: "suspense", reason: "currency", uid: link.uid };
  }
  if (link.status === "pending") return { action: "activate", uid: link.uid };
  const cents = toLimitCents(payment.amountCents, currency, limits.slsPerUsd);
  if (cents < limits.topupMinCents) {
    return { action: "suspense", reason: "below_min", uid: link.uid };
  }
  if (cents > limits.topupMaxCents) {
    return { action: "suspense", reason: "above_max", uid: link.uid };
  }
  return { action: "credit", uid: link.uid };
}

// --------------------------------------------------------------- templates

function entry(
  entryId: string,
  type: JournalEntryInput["type"],
  currency: LedgerCurrency,
  lines: JournalLine[],
  description: string,
  postedBy: string,
  refs: JournalEntryInput["refs"]
): JournalEntryInput {
  return { entryId, type, currency, lines, description, postedBy, refs };
}

/** Real money reached the collection number and is the customer's. */
export function topupEntry(p: ReceivedPayment, uid: string, transactionId: string): JournalEntryInput {
  return entry(
    `mmtopup_${receiptId(p.provider, p.operatorTxnId)}`,
    "mobile_money_topup",
    requireCurrency(p),
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
    requireCurrency(p),
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
  currency: LedgerCurrency,
  uid: string,
  adminUid: string,
  transactionId: string
): JournalEntryInput {
  return entry(
    `mmassignfloat_${receipt}`,
    "float_issue",
    currency,
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
  rates: { topupMinCents: number; topupMaxCents: number; agentFloatTopupMaxCents: number; slsPerUsd: number },
  forFloat: boolean
): TopupLimits {
  return {
    topupMinCents: rates.topupMinCents,
    topupMaxCents: forFloat ? rates.agentFloatTopupMaxCents : rates.topupMaxCents,
    slsPerUsd: rates.slsPerUsd,
    shillings: !forFloat,
  };
}

/** Real money arrived that can't be credited yet: held, never dropped. */
export function suspenseEntry(p: ReceivedPayment): JournalEntryInput {
  return entry(
    `mmsuspense_${receiptId(p.provider, p.operatorTxnId)}`,
    "mobile_money_suspense",
    requireCurrency(p),
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
  currency: LedgerCurrency,
  uid: string,
  adminUid: string,
  transactionId: string
): JournalEntryInput {
  return entry(
    `mmassign_${receipt}`,
    "mobile_money_assign",
    currency,
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
  currency: LedgerCurrency,
  adminUid: string
): JournalEntryInput {
  return entry(
    `mmrefund_${receipt}`,
    "mobile_money_refund",
    currency,
    [
      { account: MOBILE_MONEY_SUSPENSE, debit: amountCents, credit: 0 },
      { account: mobileMoneyFloat(provider), debit: 0, credit: amountCents },
    ],
    "Unmatched mobile money returned to the sender",
    adminUid,
    { receiptId: receipt }
  );
}

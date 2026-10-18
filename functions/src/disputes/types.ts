/**
 * Disputes — a claim that a transaction went wrong, with a record, an owner
 * and a deadline (plan item 2.2, decisions D6-D8).
 *
 * Lifecycle:
 *
 *   open ──reply / respondBy passes──▶ under_review ──ops──▶ resolved
 *     │                                     │                   ▲
 *     └──────────── withdrawn ◀─────────────┘    awaiting_funds ┘
 *
 * - `open`: waiting for the other party (the merchant, agent or person the
 *   claim is against) to reply, for `disputeResponseHours`.
 * - `under_review`: with ops. Ops aim to resolve by `resolveBy`.
 * - `awaiting_funds`: ops upheld it, but the other party couldn't cover the
 *   remedy. That amount is reserved in their wallet (D8) and the remedy posts
 *   as soon as their balance allows (`disputeHousekeeping`).
 * - `resolved` / `withdrawn`: final.
 *
 * A merchant refunding the payment themselves resolves its open dispute.
 */

export const DISPUTES_COLLECTION = "disputes";

export type DisputeKind =
  /** Paid, but the goods or service never came. */
  | "not_received"
  /** Charged more than agreed. */
  | "wrong_amount"
  /** "I didn't make this payment." */
  | "unauthorised"
  /** The merchant agreed to refund and didn't. */
  | "refund_not_given"
  /** Cash-out confirmed, but the agent didn't hand over the cash. */
  | "cash_not_given"
  /** Cash handed to an agent for a top-up that was never credited. */
  | "cash_given_not_credited"
  /** Sent to the wrong person. */
  | "wrong_recipient"
  | "other";

export const DISPUTE_KINDS: readonly DisputeKind[] = [
  "not_received",
  "wrong_amount",
  "unauthorised",
  "refund_not_given",
  "cash_not_given",
  "cash_given_not_credited",
  "wrong_recipient",
  "other",
];

export type DisputeStatus = "open" | "under_review" | "awaiting_funds" | "resolved" | "withdrawn";

/** Statuses a dispute can still move on from. */
export const ACTIVE_STATUSES: readonly DisputeStatus[] = ["open", "under_review", "awaiting_funds"];

export function isFinal(status: DisputeStatus): boolean {
  return status === "resolved" || status === "withdrawn";
}

/** What kind of movement is being disputed; decides the claims that fit. */
export type DisputedKind =
  | "shop_payment"
  | "online_payment"
  | "p2p"
  | "payroll"
  | "cash_in"
  | "cash_out"
  | "uncredited_cash_in"
  | "other";

export type DisputeSide = "payer" | "payee";

/**
 * Claims each side of each kind of movement may raise. The payer is whoever
 * the money left; the payee whoever it reached. Anything not listed may still
 * be raised as `other`, so nobody is ever left without a way to complain.
 */
const ALLOWED: Partial<Record<DisputedKind, Partial<Record<DisputeSide, DisputeKind[]>>>> = {
  shop_payment: { payer: ["not_received", "wrong_amount", "unauthorised", "refund_not_given"] },
  online_payment: { payer: ["not_received", "wrong_amount", "unauthorised", "refund_not_given"] },
  p2p: { payer: ["wrong_recipient", "unauthorised", "not_received"] },
  // A cash-in moves value agent → customer, so the customer is the payee.
  cash_in: { payee: ["wrong_amount"] },
  // A cash-out moves value customer → agent; the customer is the payer.
  cash_out: { payer: ["cash_not_given", "wrong_amount"] },
  uncredited_cash_in: { payee: ["cash_given_not_credited"] },
};

export function allowedKinds(kind: DisputedKind, side: DisputeSide): DisputeKind[] {
  return [...(ALLOWED[kind]?.[side] ?? []), "other"];
}

export interface DisputeMessage {
  by: string;
  role: "raiser" | "counterparty" | "ops";
  text: string;
  at: FirebaseFirestore.Timestamp;
}

export type DisputeRemedy = "refund" | "adjustment" | "none";

export interface DisputeResolution {
  outcome: "upheld" | "rejected";
  /** Cents returned to the raiser; 0 when rejected. */
  amountCents: number;
  remedy: DisputeRemedy;
  /** Who funds an upheld remedy: the other party, or Zapp. */
  payFrom: "counterparty" | "platform" | null;
  reason: string;
  decidedBy: string;
  decidedAt: FirebaseFirestore.Timestamp;
  /** Set once the remedy has posted (at once, or later from the reserve). */
  settledAt?: FirebaseFirestore.Timestamp;
  journalEntryId?: string;
  refundTransactionId?: string;
}

export interface DisputeDoc {
  /** The disputed transaction; absent for an uncredited cash-in. */
  transactionId?: string;
  /** For `cash_given_not_credited`: the agent top-up request that expired. */
  agentTopupRequestId?: string;
  disputedKind: DisputedKind;
  kind: DisputeKind;
  status: DisputeStatus;
  raisedBy: string;
  /** The other party, when there is one to answer. */
  against: string | null;
  /** Who may read it: raiser, and the other party if any. */
  participants: string[];
  /** What the raiser says they are owed, in cents. */
  amountCents: number;
  /** The disputed movement's own amount, the ceiling for any remedy. */
  transactionAmountCents: number;
  currency: "USD";
  messages: DisputeMessage[];
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  /** When the other party's time to reply ends (D7). */
  respondBy: FirebaseFirestore.Timestamp;
  /** When ops should have resolved it by (D7). */
  resolveBy: FirebaseFirestore.Timestamp;
  /** Upheld but not yet covered: what the other party still owes. */
  owedCents?: number;
  resolution?: DisputeResolution;
  withdrawnAt?: FirebaseFirestore.Timestamp;
}

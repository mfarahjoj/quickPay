/**
 * Zaad top-ups through agents.
 *
 * The customer asks for $X. Zapp offers the request to one online agent at a
 * time. The agent who accepts has $X of float held; the customer pays the
 * agent's Zaad number quoting Zapp's reference and taps "I've sent it"; the agent checks
 * their own Zaad and confirms; the held float is paid to the customer.
 *
 * No Telesom API is involved and Zapp never touches the Zaad money: it goes
 * person to person, customer → agent. What Zapp guarantees is that the value
 * credited to the customer was float the agent had already bought.
 *
 * Plan: docs/ZAPP_AGENT_ZAAD_TOPUP_PLAN.md in the Ridy driver repo
 * (~/ridyhargeisadriver), decisions D1–D17.
 *
 *   offered ─accept─▶ accepted ─customer: sent─▶ customer_sent ─agent: received─▶ completed
 *     │ (next agent,     │ send time passes            │ agent: not received
 *     │  up to N)        ▼                              ▼
 *     ▼               expired (float back)           declined ─customer disputes─▶ disputed ─ops─▶ completed | released
 *   no_agent                                            │ dispute window passes
 *                                                       ▼
 *                                                     released (float back)
 *   customer_sent ─agent doesn't answer in time─▶ disputed
 *   offered / accepted ─customer cancels─▶ cancelled
 */

import type { Timestamp } from "firebase-admin/firestore";

/** zaadAgentTopups/{id}: one customer request. */
export const ZAAD_AGENT_TOPUPS = "zaadAgentTopups";
/** zaad_agents/{uid}: an agent's receiving number (checked in person) and presence. */
export const ZAAD_AGENTS = "zaad_agents";
/** zaad_agent_customers/{uid}: lost disputes and blocks. */
export const ZAAD_AGENT_CUSTOMERS = "zaad_agent_customers";
/** zaad_agent_refs/{reference}: Zapp's reference for each request, claimed once. */
export const ZAAD_AGENT_REFS = "zaad_agent_refs";
/** zaad_agent_txn_ids/{txnId}: each Zaad transaction ID claims one request. */
export const ZAAD_AGENT_TXN_IDS = "zaad_agent_txn_ids";

export type ZaadTopupStatus =
  | "offered"
  | "no_agent"
  | "accepted"
  | "customer_sent"
  | "declined"
  | "disputed"
  | "completed"
  | "released"
  | "expired"
  | "cancelled";

/** Statuses in which the agent's float sits in platform:zaad_agent_hold. */
export const HELD_STATUSES: readonly ZaadTopupStatus[] = ["accepted", "customer_sent", "declined", "disputed"];

/** Statuses that block the customer from asking for another top-up. */
export const ACTIVE_STATUSES: readonly ZaadTopupStatus[] = ["offered", "accepted", "customer_sent", "disputed"];

export type AgentAnswer = "received" | "not_received" | "different_amount";

export type ReleaseReason = "cancelled" | "expired" | "declined" | "ops_for_agent";

export interface ZaadOffer {
  agentId: string;
  offeredAt: Timestamp;
  expiresAt: Timestamp;
  answer?: "accepted" | "declined" | "timed_out" | "taken";
  answeredAt?: Timestamp;
}

export interface ZaadReversal {
  status: "reported" | "confirmed" | "rejected";
  reportedAt: Timestamp;
  /** The reversal's own Zaad transaction ID, if Telesom gave the agent one. */
  agentZaadTxnId?: string;
  note: string;
  decidedBy?: string;
  decidedAt?: Timestamp;
  decisionReason?: string;
  fromCustomerCents?: number;
  fromZappCents?: number;
  entryId?: string;
}

export interface ZaadAgentTopup {
  customerId: string;
  /** First name only, for the agent's offer screen. */
  customerFirstName: string;
  /**
   * Zapp's reference, such as "ZP-4F7K2", made when the request is (D31).
   * Shown to both sides and on the receipt. Missing on requests made before it.
   */
  reference?: string;
  /** US cents. Dollars only at launch (D14). */
  amount: number;
  /**
   * "in_person": the agent scanned the customer's code and chose Zaad
   * (inPerson.ts); created already accepted, never offered, and outside the
   * agent's one-request-at-a-time slot (D26). Missing on requests made before
   * it existed: remote.
   */
  meeting?: "in_person" | "remote";
  currency: "USD";
  status: ZaadTopupStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** The next moment the sweep has something to do with this request; null when nothing is timed. */
  deadlineAt: Timestamp | null;

  offers: ZaadOffer[];
  /**
   * Every agent whose phone is ringing now (the request rings on several at
   * once; the first to accept wins). Missing on requests made before that:
   * read [offeredTo].
   */
  offeredToIds?: string[];
  /** The first of [offeredToIds], kept for older merchant builds. */
  offeredTo: string | null;
  /** What the agent earns if this completes, in US cents, from the rate when it was asked. */
  agentCommissionCents?: number;
  offerExpiresAt: Timestamp | null;

  /** Set when an agent accepts. */
  agentId: string | null;
  agentName?: string;
  /** The agent's receiving Zaad number, shown to the customer only after accepting. */
  agentReceiveMsisdn?: string;
  dialCode?: string | null;
  /** Numbers the customer may pay from (D5), shown masked to the agent. */
  allowedSenders?: string[];
  acceptedAt?: Timestamp;
  sendBy?: Timestamp;
  holdEntryId?: string;

  /** Zaad's transaction ID, if the customer typed one (builds 82–83 did; optional since D31). */
  customerZaadTxnId?: string;
  customerSentAt?: Timestamp;
  /** When the agent was told 5 minutes are left to answer (D32); set once. */
  reminderSentAt?: Timestamp;
  /** Zaad's transaction ID from the agent's "you received" text, if they gave it on "Received". */
  agentZaadTxnId?: string;
  confirmBy?: Timestamp;

  agentAnswer?: AgentAnswer;
  agentAnsweredAt?: Timestamp;
  disputeUntil?: Timestamp;
  disputedAt?: Timestamp;
  disputeReason?: string;
  /** "customer": the customer disputed; "timeout": the agent didn't answer. */
  disputedBy?: "customer" | "timeout";

  transactionId?: string;
  creditEntryId?: string;
  commissionCents?: number;
  completedAt?: Timestamp;
  releaseEntryId?: string;
  releaseReason?: ReleaseReason;
  releasedAt?: Timestamp;
  resolution?: { outcome: "customer" | "agent"; by: string; reason: string; at: Timestamp };
  reversal?: ZaadReversal;
}

export interface ZaadAgentDoc {
  /** E.164, checked in person by ops (D4). */
  receiveMsisdn: string | null;
  verifiedBy?: string;
  verifiedAt?: Timestamp;
  /** Ops switched this agent on for Zaad top-ups. */
  enabled: boolean;
  /** No offers until then: set when the receiving number changes. */
  pausedUntil?: Timestamp | null;
  online: boolean;
  lastSeenAt?: Timestamp | null;
  /**
   * Remote requests ringing on, or held for, this agent, oldest first: up to
   * `zaadAgentMaxOpenRequests` at once (D32, replacing D6's one at a time).
   * Missing on docs written before D32: read [openRequestId] instead.
   */
  openRequestIds?: string[];
  /** The newest of [openRequestIds], or null. Kept for merchant builds ≤ 31, which show one request. */
  openRequestId: string | null;
  lastOfferedAt?: Timestamp | null;
  /** Offers in a row the agent let time out; two take them offline (D8). */
  missedOffers?: number;
}

export interface ZaadAgentCustomerDoc {
  /** When each lost dispute was decided, in ms. */
  strikes?: number[];
  blocked?: boolean;
  /** The customer's latest request: one may be in progress at a time. */
  activeRequestId?: string;
  blockedReason?: "strikes" | "reversal";
  blockedAt?: Timestamp;
}

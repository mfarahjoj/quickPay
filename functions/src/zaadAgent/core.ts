/**
 * Zaad top-ups through agents: the pure parts. No Firestore here, so every
 * rule about money and matching can be tested on its own.
 */

import { randomInt } from "crypto";
import { JournalEntryInput, JournalLine } from "../ledger";
import {
  agentAccount,
  userAccount,
  PLATFORM_FEES,
  ZAAD_AGENT_HOLD,
  ZAAD_REVERSAL_LOSSES,
} from "../ledger/accounts";
import { ReleaseReason, ZaadAgentDoc } from "./types";

/** An agent whose app hasn't checked in for this long is treated as offline. */
export const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
/** Offers in a row an agent may let time out before they're taken offline (D8). */
export const MAX_MISSED_OFFERS = 2;

// ------------------------------------------------------------------ entries

export const holdEntryId = (requestId: string) => `zaadagenthold_${requestId}`;
export const creditEntryId = (requestId: string) => `zaadagent_${requestId}`;
export const releaseEntryId = (requestId: string) => `zaadagentrelease_${requestId}`;
export const reversalEntryId = (requestId: string) => `zaadagentreversal_${requestId}`;

/** The agent accepted: their float is set aside for this customer. */
export function holdEntry(requestId: string, agentId: string, amount: number): JournalEntryInput {
  return {
    entryId: holdEntryId(requestId),
    type: "zaad_agent_hold",
    currency: "USD",
    lines: [
      { account: agentAccount(agentId), debit: amount, credit: 0 },
      { account: ZAAD_AGENT_HOLD, debit: 0, credit: amount },
    ],
    description: "Float held for a Zaad top-up",
    postedBy: agentId,
    refs: { topupId: requestId },
  };
}

/**
 * The held float goes to the customer. Commission is paid to the agent's own
 * wallet from Zapp's fees, as for every cash-in (agentConfirmTopup).
 */
export function creditEntry(
  requestId: string,
  agentId: string,
  customerId: string,
  amount: number,
  commissionCents: number,
  transactionId: string,
  postedBy: string
): JournalEntryInput {
  const lines: JournalLine[] = [
    { account: ZAAD_AGENT_HOLD, debit: amount, credit: 0 },
    { account: userAccount(customerId), debit: 0, credit: amount },
  ];
  if (commissionCents > 0) {
    lines.push({ account: PLATFORM_FEES, debit: commissionCents, credit: 0 });
    lines.push({ account: userAccount(agentId), debit: 0, credit: commissionCents });
  }
  return {
    entryId: creditEntryId(requestId),
    type: "zaad_agent_topup",
    currency: "USD",
    lines,
    description: postedBy === agentId ? "Zaad top-up via agent" : "Zaad top-up via agent, credited by Zapp",
    postedBy,
    refs: { transactionId, topupId: requestId },
  };
}

const RELEASE_COPY: Record<ReleaseReason, string> = {
  cancelled: "Zaad top-up cancelled: float returned",
  expired: "Zaad top-up not sent in time: float returned",
  declined: "Zaad top-up not received: float returned",
  ops_for_agent: "Zaad top-up dispute decided for the agent: float returned",
};

/** The request ended unpaid: the held float goes back to the agent. */
export function releaseEntry(
  requestId: string,
  agentId: string,
  amount: number,
  reason: ReleaseReason,
  postedBy: string
): JournalEntryInput {
  return {
    entryId: releaseEntryId(requestId),
    type: "zaad_agent_release",
    currency: "USD",
    lines: [
      { account: ZAAD_AGENT_HOLD, debit: amount, credit: 0 },
      { account: agentAccount(agentId), debit: 0, credit: amount },
    ],
    description: RELEASE_COPY[reason],
    postedBy,
    refs: { topupId: requestId },
  };
}

/** How a confirmed reversal is paid back to the agent (D16). */
export function splitReversal(amount: number, customerBalance: number): { fromCustomer: number; fromZapp: number } {
  const fromCustomer = Math.max(0, Math.min(amount, Math.floor(customerBalance)));
  return { fromCustomer, fromZapp: amount - fromCustomer };
}

/**
 * Telesom reversed the customer's payment after Zapp credited them. The agent's
 * float is repaid in full: from what is left of the customer's wallet, the rest
 * from Zapp's reversal losses.
 */
export function reversalEntry(
  requestId: string,
  agentId: string,
  customerId: string,
  fromCustomer: number,
  fromZapp: number,
  postedBy: string
): JournalEntryInput {
  const lines: JournalLine[] = [];
  if (fromCustomer > 0) lines.push({ account: userAccount(customerId), debit: fromCustomer, credit: 0 });
  if (fromZapp > 0) lines.push({ account: ZAAD_REVERSAL_LOSSES, debit: fromZapp, credit: 0 });
  lines.push({ account: agentAccount(agentId), debit: 0, credit: fromCustomer + fromZapp });
  return {
    entryId: reversalEntryId(requestId),
    type: "zaad_agent_reversal",
    currency: "USD",
    lines,
    description: "Zaad payment reversed by Telesom: agent's float repaid",
    postedBy,
    refs: { topupId: requestId },
  };
}

// ----------------------------------------------------------------- matching

export interface Candidate {
  id: string;
  doc: ZaadAgentDoc;
}

/** The remote requests open on this agent (D32), from either shape of the doc. */
export function openIds(doc: Pick<ZaadAgentDoc, "openRequestIds" | "openRequestId"> | undefined): string[] {
  if (!doc) return [];
  return doc.openRequestIds ?? (doc.openRequestId ? [doc.openRequestId] : []);
}

/** The fields to write when [id] opens on the agent. */
export function withOpen(doc: ZaadAgentDoc | undefined, id: string): Pick<ZaadAgentDoc, "openRequestIds" | "openRequestId"> {
  const ids = [...openIds(doc).filter((x) => x !== id), id];
  return { openRequestIds: ids, openRequestId: id };
}

/** The fields to write when [id] is done with the agent, or null if it wasn't open on them. */
export function withoutOpen(
  doc: ZaadAgentDoc | undefined,
  id: string
): Pick<ZaadAgentDoc, "openRequestIds" | "openRequestId"> | null {
  const ids = openIds(doc);
  if (!ids.includes(id)) return null;
  const rest = ids.filter((x) => x !== id);
  return { openRequestIds: rest, openRequestId: rest[rest.length - 1] ?? null };
}

/**
 * Whether this agent can be offered a request right now, on what their
 * zaad_agents doc says. [maxOpen]: `zaadAgentMaxOpenRequests` (D32). Free
 * float is checked separately (dispatch.ts).
 */
export function isAvailable(doc: ZaadAgentDoc, nowMs: number, maxOpen = 1): boolean {
  if (!doc.enabled || !doc.online || !doc.receiveMsisdn) return false;
  if (openIds(doc).length >= maxOpen) return false;
  if (doc.pausedUntil && doc.pausedUntil.toMillis() > nowMs) return false;
  const seen = doc.lastSeenAt?.toMillis() ?? 0;
  return nowMs - seen <= HEARTBEAT_STALE_MS;
}

/**
 * Agents to try, in order: available, not the customer, not already offered
 * this request, and the one who has waited longest since their last offer
 * first, so offers are shared fairly (D7).
 */
export function rankCandidates(
  candidates: Candidate[],
  opts: { nowMs: number; customerId: string; alreadyOffered: Set<string>; maxOpen?: number }
): Candidate[] {
  return candidates
    .filter(
      (c) =>
        c.id !== opts.customerId && !opts.alreadyOffered.has(c.id) && isAvailable(c.doc, opts.nowMs, opts.maxOpen ?? 1)
    )
    .sort((a, b) => (a.doc.lastOfferedAt?.toMillis() ?? 0) - (b.doc.lastOfferedAt?.toMillis() ?? 0));
}

// ------------------------------------------------------------------- people

/** "+252634123456" → "063 ••• 3456", for showing a number without giving it away. */
export function maskMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\D/g, "");
  if (digits.startsWith("252") && digits.length >= 12) {
    return `0${digits.slice(3, 5)} ••• ${digits.slice(-4)}`;
  }
  return `••• ${digits.slice(-4)}`;
}

/** "+252634123456" → "063 412 3456", the way Somalilanders write it. */
export function displayMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\D/g, "");
  if (digits.startsWith("252") && digits.length === 12) {
    const n = `0${digits.slice(3)}`;
    return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return msisdn;
}

export function firstName(fullName: unknown): string {
  if (typeof fullName !== "string") return "Customer";
  return fullName.trim().split(/\s+/)[0] || "Customer";
}

/**
 * Characters for Zapp's own top-up reference: no 0/O, 1/I/L, 5/S, 8/B, 2/Z
 * or U/V, so it reads aloud and copies by hand without mistakes.
 */
export const TOPUP_REFERENCE_ALPHABET = "34679ACDEFGHJKMNPQRTWXY";
export const TOPUP_REFERENCE_LENGTH = 5;
const REFERENCE_PATTERN = new RegExp(`^ZP-[${TOPUP_REFERENCE_ALPHABET}]{${TOPUP_REFERENCE_LENGTH}}$`);

/** A fresh reference such as "ZP-4F7K2" (23^5 ≈ 6.4M of them). Unique only once claimed. */
export function newTopupReference(pick: (n: number) => number = randomInt): string {
  let out = "";
  for (let i = 0; i < TOPUP_REFERENCE_LENGTH; i++) out += TOPUP_REFERENCE_ALPHABET[pick(TOPUP_REFERENCE_ALPHABET.length)];
  return `ZP-${out}`;
}

export function isTopupReference(s: unknown): s is string {
  return typeof s === "string" && REFERENCE_PATTERN.test(s);
}

/** A Zaad transaction ID as the customer typed it, cleaned; null if it can't be one. */
export function normaliseTxnId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9_-]{4,64}$/.test(t) ? t : null;
}

/** Lost disputes still inside the window. */
export function activeStrikes(strikes: number[] | undefined, windowDays: number, nowMs: number): number {
  const since = nowMs - windowDays * 24 * 3600 * 1000;
  return (strikes ?? []).filter((at) => at >= since).length;
}

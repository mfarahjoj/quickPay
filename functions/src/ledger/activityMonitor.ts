/**
 * Activity monitor — the business-level half of reconciliation.
 *
 * The invariant check proves the books are internally consistent: every
 * entry nets to zero and every projection matches the journal. It cannot see
 * value created by a flow that posts perfectly balanced entries for the wrong
 * reason. The self top-up bug (an agent topping up their own wallet and
 * collecting commission from platform:fees on every call) did exactly that:
 * every entry it posted was valid, so the invariant check stayed green.
 *
 * So this reads the last day of the journal and looks for the shapes that
 * value creation leaves behind:
 *
 * - `self_dealing` — one entry both debits and credits the same wallet and
 *   leaves it better off. A legitimate agent cash-in debits the agent's float
 *   and credits back only the commission, so the agent nets down; the self
 *   top-up netted up by the commission.
 * - `agent_commission` — one account collected more commission than a pilot
 *   agent plausibly earns in a day.
 * - `round_trip` — an agent cashed a customer in and value came back from
 *   that customer to the same agent the same day, so commission was paid
 *   on value that may never have been cash.
 * - `fees_net` — platform:fees fell further in a day than the configured
 *   floor: the platform paid out more commission than it took in fees.
 *
 * Findings are leads, not verdicts. Nothing here blocks or reverses money;
 * ops review them on the Ledger Desk.
 */

import * as admin from "firebase-admin";
import { JournalEntryDoc, JournalLine } from "./types";
import { CASHOUT_HOLD, PLATFORM_FEES, isUserAccount } from "./accounts";
import { JOURNAL_COLLECTION } from "./post";

export type ActivityKind = "self_dealing" | "agent_commission" | "round_trip" | "fees_net";

export interface ActivityFinding {
  kind: ActivityKind;
  /** The account the finding is about (the agent, for round trips). */
  account: string;
  /** The other side, for round trips. */
  counterparty?: string;
  /** Cents: commission gained, value returned, or the fees net. */
  amount: number;
  /** How many entries are behind it. */
  count: number;
  /** Up to MAX_ENTRY_IDS of them, for tracing. */
  entryIds: string[];
  detail: string;
}

export interface MonitorThresholds {
  /** Commission one account may collect in the window before it is flagged. */
  agentCommissionDailyCents: number;
  /** Flag platform:fees when its net for the window is below minus this. */
  feesNetFloorCents: number;
  /**
   * Flag a round trip when the value back from the customer reaches this
   * share of what the agent cashed in to them.
   */
  roundTripReturnRatio: number;
  /**
   * Ignore round trips smaller than this. A customer who cashes in $20 at a
   * shop that is also an agent and spends $15 there is ordinary trade.
   */
  roundTripMinCents: number;
}

export const DEFAULT_MONITOR_THRESHOLDS: MonitorThresholds = {
  // 2% commission on $2,500 of cash-in. Generous for a Hargeisa pilot agent,
  // and a self top-up loop clears it in a few hundred calls.
  agentCommissionDailyCents: 5_000,
  feesNetFloorCents: 10_000,
  roundTripReturnRatio: 0.5,
  roundTripMinCents: 10_000,
};

export const MONITOR_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Entries read per run. A day of pilot traffic is far below this. */
const MAX_ENTRIES = 20_000;
const MAX_ENTRY_IDS = 10;

/** Entry types where an agent hands value to a customer. */
const CASH_IN_TYPES = new Set(["agent_topup"]);

/**
 * Entry types that can carry value from a customer back to an agent in one
 * entry. (A held cash-out does it in two; see the hold pass below.)
 */
const RETURN_TYPES = new Set([
  "p2p",
  "qr_payment",
  "customer_qr_payment",
  "online_payment",
  "agent_cashout",
  "payroll",
  "refund",
]);

/** An entry as the monitor reads it. */
export interface MonitoredEntry {
  id: string;
  type: string;
  lines: JournalLine[];
  /**
   * Cash-out settles only: the customer whose hold this pays out. The settle
   * entry moves platform:cashout_hold → agent, so the customer is only on the
   * hold entry posted when they asked; runActivityMonitor joins it in.
   */
  customer?: string;
}

function perAccount(lines: JournalLine[]) {
  const byAccount = new Map<string, { debits: number; credits: number }>();
  for (const line of lines) {
    const agg = byAccount.get(line.account) ?? { debits: 0, credits: 0 };
    agg.debits += line.debit;
    agg.credits += line.credit;
    byAccount.set(line.account, agg);
  }
  return byAccount;
}

/** What platform:fees paid out in this entry, credited to whom. */
function commissionPaid(entry: MonitoredEntry): { account: string; cents: number } | null {
  const fees = entry.lines.find((l) => l.account === PLATFORM_FEES && l.debit > 0);
  if (!fees) return null;
  // Commission pairs are posted as platform:fees debit + user credit of the
  // same amount; agent flows are the only ones that debit platform:fees for
  // a user. Refunds also debit fees (returning the fee), so restrict to the
  // agent entry types.
  if (entry.type !== "agent_topup" && entry.type !== "agent_cashout") return null;
  const credit = entry.lines.find(
    (l) => isUserAccount(l.account) && l.credit === fees.debit
  );
  return credit ? { account: credit.account, cents: fees.debit } : null;
}

/** Cents → "$1,234.56" / "-$12.00" for the messages ops read. */
const usd = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const add = (map: Map<string, number>, key: string, cents: number) =>
  map.set(key, (map.get(key) ?? 0) + cents);

function pushId(map: Map<string, string[]>, key: string, id: string) {
  const ids = map.get(key) ?? [];
  if (ids.length < MAX_ENTRY_IDS) ids.push(id);
  map.set(key, ids);
}

/**
 * Analyse one window of entries. Pure: no Firestore, so every rule is
 * unit-testable on hand-built entries.
 */
export function analyzeActivity(
  entries: MonitoredEntry[],
  thresholds: MonitorThresholds = DEFAULT_MONITOR_THRESHOLDS
): ActivityFinding[] {
  const findings: ActivityFinding[] = [];

  // self_dealing — per entry
  for (const entry of entries) {
    perAccount(entry.lines).forEach((agg, account) => {
      if (!isUserAccount(account)) return;
      const net = agg.credits - agg.debits;
      if (agg.debits > 0 && agg.credits > 0 && net > 0) {
        findings.push({
          kind: "self_dealing",
          account,
          amount: net,
          count: 1,
          entryIds: [entry.id],
          detail:
            `Entry ${entry.id} (${entry.type}) debits and credits this wallet and ` +
            "leaves it better off: the shape of an agent topping up their own account.",
        });
      }
    });
  }

  // agent_commission — per account across the window
  const commission = new Map<string, number>();
  const commissionCount = new Map<string, number>();
  const commissionIds = new Map<string, string[]>();
  for (const entry of entries) {
    const paid = commissionPaid(entry);
    if (!paid) continue;
    add(commission, paid.account, paid.cents);
    add(commissionCount, paid.account, 1);
    pushId(commissionIds, paid.account, entry.id);
  }
  commission.forEach((cents, account) => {
    if (cents > thresholds.agentCommissionDailyCents) {
      findings.push({
        kind: "agent_commission",
        account,
        amount: cents,
        count: commissionCount.get(account) ?? 0,
        entryIds: commissionIds.get(account) ?? [],
        detail:
          `Collected ${usd(cents)} of commission in 24h across ` +
          `${commissionCount.get(account)} entries, over the ` +
          `${usd(thresholds.agentCommissionDailyCents)} threshold.`,
      });
    }
  });

  // round_trip — agent → customer by cash-in, then customer → agent
  const cashedIn = new Map<string, number>(); // "agent|customer" -> cents
  const returned = new Map<string, number>();
  const pairIds = new Map<string, string[]>();
  const pairCommission = new Map<string, number>();
  for (const entry of entries) {
    const accounts = perAccount(entry.lines);
    const payers = [...accounts].filter(
      ([a, v]) => isUserAccount(a) && v.debits > v.credits
    );
    const payees = [...accounts].filter(
      ([a, v]) => isUserAccount(a) && v.credits > v.debits
    );
    if (CASH_IN_TYPES.has(entry.type)) {
      for (const [agent, a] of payers) {
        for (const [customer, c] of payees) {
          if (agent === customer) continue;
          const key = `${agent}|${customer}`;
          add(cashedIn, key, Math.min(a.debits - a.credits, c.credits - c.debits));
          const paid = commissionPaid(entry);
          if (paid?.account === agent) add(pairCommission, key, paid.cents);
          pushId(pairIds, key, entry.id);
        }
      }
    } else if (RETURN_TYPES.has(entry.type)) {
      for (const [customer, c] of payers) {
        for (const [agent, a] of payees) {
          if (agent === customer) continue;
          const key = `${agent}|${customer}`;
          add(returned, key, Math.min(c.debits - c.credits, a.credits - a.debits));
          pushId(pairIds, key, entry.id);
        }
      }
    }
  }
  // A held cash-out never puts customer and agent in one entry: the customer
  // pays into platform:cashout_hold, and the settle pays the agent out of it.
  // The settle carries the customer (joined from the hold entry), so "cash
  // in, then straight back out at the same agent" still pairs up.
  for (const entry of entries) {
    if (entry.type !== "agent_cashout" || !entry.customer) continue;
    const hold = entry.lines.find((l) => l.account === CASHOUT_HOLD && l.debit > 0);
    if (!hold) continue;
    const agentLine = entry.lines.find(
      (l) => isUserAccount(l.account) && l.credit === hold.debit
    );
    const customer = entry.customer;
    if (!agentLine) continue;
    const key = `${agentLine.account}|${customer}`;
    if (!cashedIn.has(key)) continue;
    add(returned, key, hold.debit);
    pushId(pairIds, key, entry.id);
  }
  cashedIn.forEach((inCents, key) => {
    const back = returned.get(key) ?? 0;
    if (inCents <= 0 || back < inCents * thresholds.roundTripReturnRatio) return;
    if (back < thresholds.roundTripMinCents) return;
    const [agent, customer] = key.split("|");
    findings.push({
      kind: "round_trip",
      account: agent,
      counterparty: customer,
      amount: back,
      count: (pairIds.get(key) ?? []).length,
      entryIds: pairIds.get(key) ?? [],
      detail:
        `Cashed in ${usd(inCents)} to this customer and got ${usd(back)} back ` +
        `within 24h, earning ${usd(pairCommission.get(key) ?? 0)} of commission on the way.`,
    });
  });

  // fees_net — the platform's own account over the window
  let feesNet = 0;
  let feesCount = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.account !== PLATFORM_FEES) continue;
      feesNet += line.credit - line.debit;
      feesCount++;
    }
  }
  if (feesNet < -thresholds.feesNetFloorCents) {
    findings.push({
      kind: "fees_net",
      account: PLATFORM_FEES,
      amount: feesNet,
      count: feesCount,
      entryIds: [],
      detail:
        `platform:fees moved ${usd(feesNet)} in 24h: commission paid out exceeded ` +
        `fees taken by more than the ${usd(thresholds.feesNetFloorCents)} floor.`,
    });
  }

  return findings;
}

function coerceCents(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function coerceRatio(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : fallback;
}

/** Thresholds from Firestore `config/monitor`, falling back to the defaults. */
export async function getMonitorThresholds(): Promise<MonitorThresholds> {
  try {
    const snap = await admin.firestore().collection("config").doc("monitor").get();
    const data = snap.exists ? snap.data() ?? {} : {};
    return {
      agentCommissionDailyCents: coerceCents(
        data.agentCommissionDailyCents,
        DEFAULT_MONITOR_THRESHOLDS.agentCommissionDailyCents
      ),
      feesNetFloorCents: coerceCents(
        data.feesNetFloorCents,
        DEFAULT_MONITOR_THRESHOLDS.feesNetFloorCents
      ),
      roundTripReturnRatio: coerceRatio(
        data.roundTripReturnRatio,
        DEFAULT_MONITOR_THRESHOLDS.roundTripReturnRatio
      ),
      roundTripMinCents: coerceCents(
        data.roundTripMinCents,
        DEFAULT_MONITOR_THRESHOLDS.roundTripMinCents
      ),
    };
  } catch (error) {
    console.error("Failed to load config/monitor, using defaults:", error);
    return DEFAULT_MONITOR_THRESHOLDS;
  }
}

export interface ActivityReport {
  findings: ActivityFinding[];
  entryCount: number;
  /** True when the window held more than MAX_ENTRIES and only part was read. */
  truncated: boolean;
}

/** Read the last 24h of the journal and analyse it. */
export async function runActivityMonitor(now: Date = new Date()): Promise<ActivityReport> {
  const db = admin.firestore();
  const since = admin.firestore.Timestamp.fromMillis(now.getTime() - MONITOR_WINDOW_MS);

  const snap = await db
    .collection(JOURNAL_COLLECTION)
    .where("postedAt", ">=", since)
    .limit(MAX_ENTRIES + 1)
    .get();

  const docs = snap.docs.slice(0, MAX_ENTRIES);
  const entries: MonitoredEntry[] = docs.map((doc) => {
    const e = doc.data() as JournalEntryDoc;
    return { id: doc.id, type: e.type, lines: e.lines ?? [] };
  });

  // A cash-out settle only names the hold and the agent; the customer is on
  // the hold entry posted when they asked. Join them by cash-out id so the
  // round-trip rule can see "cashed in, then cashed straight back out".
  const holdCustomer = new Map<string, string>();
  for (const e of entries) {
    if (!e.id.startsWith("cashouthold_")) continue;
    const payer = e.lines.find((l) => isUserAccount(l.account) && l.debit > 0);
    if (payer) holdCustomer.set(e.id.slice("cashouthold_".length), payer.account);
  }
  const missing = entries
    .filter((e) => e.id.startsWith("cashout_") && !holdCustomer.has(e.id.slice("cashout_".length)))
    .map((e) => e.id.slice("cashout_".length));
  if (missing.length) {
    const refs = missing.map((id) => db.collection(JOURNAL_COLLECTION).doc(`cashouthold_${id}`));
    const holds = await db.getAll(...refs);
    holds.forEach((h, i) => {
      const lines = (h.data()?.lines ?? []) as JournalLine[];
      const payer = lines.find((l) => isUserAccount(l.account) && l.debit > 0);
      if (payer) holdCustomer.set(missing[i], payer.account);
    });
  }
  for (const e of entries) {
    if (!e.id.startsWith("cashout_")) continue;
    const customer = holdCustomer.get(e.id.slice("cashout_".length));
    if (customer) e.customer = customer;
  }

  const thresholds = await getMonitorThresholds();
  return {
    findings: analyzeActivity(entries, thresholds),
    entryCount: entries.length,
    truncated: snap.size > MAX_ENTRIES,
  };
}

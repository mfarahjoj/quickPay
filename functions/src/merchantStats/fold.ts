/**
 * Folding one shop event into the read-model docs. Pure: every function
 * takes the current doc (or undefined) and returns the next one, so the
 * same code serves the live trigger, the nightly catch-up and the checks.
 */

import { localParts, daysBetween } from "./time";
import {
  CurrencyPeriod,
  CustomerStats,
  PeriodStats,
  RecentFeed,
  RecentItem,
  RECENT_MAX,
  SALE_CHANNELS,
  SaleChannel,
  StatsCurrency,
  StoreEvent,
  StoreStatsRoot,
} from "./types";

/** Weight of the newest gap in a customer's usual gap between visits. */
const GAP_WEIGHT = 0.3;

export function emptyCurrencyPeriod(): CurrencyPeriod {
  const channels = {} as Record<SaleChannel, { count: number; net: number }>;
  for (const c of SALE_CHANNELS) channels[c] = { count: 0, net: 0 };
  return {
    sales: { count: 0, gross: 0, fee: 0, net: 0 },
    refunds: { count: 0, gross: 0, fee: 0, net: 0 },
    hours: { count: new Array(24).fill(0), net: new Array(24).fill(0) },
    channels,
    agent: { cashIn: { count: 0, amount: 0 }, cashOut: { count: 0, amount: 0 }, commission: 0 },
  };
}

export function emptyPeriod(storeUid: string, period: string): PeriodStats {
  return { storeUid, period, currencies: {}, customers: { unique: 0, new: 0, returning: 0 }, updatedAtMs: 0 };
}

/** A stored doc filled out to the current shape (older docs, new channels). */
function normalizeCurrency(c: Partial<CurrencyPeriod> | undefined): CurrencyPeriod {
  const e = emptyCurrencyPeriod();
  if (!c) return e;
  const hours = (a: unknown) => (Array.isArray(a) && a.length === 24 ? a.map((n) => Number(n) || 0) : new Array(24).fill(0));
  const channels = { ...e.channels };
  for (const ch of SALE_CHANNELS) channels[ch] = { ...e.channels[ch], ...(c.channels?.[ch] ?? {}) };
  return {
    sales: { ...e.sales, ...(c.sales ?? {}) },
    refunds: { ...e.refunds, ...(c.refunds ?? {}) },
    hours: { count: hours(c.hours?.count), net: hours(c.hours?.net) },
    channels,
    agent: {
      cashIn: { ...e.agent.cashIn, ...(c.agent?.cashIn ?? {}) },
      cashOut: { ...e.agent.cashOut, ...(c.agent?.cashOut ?? {}) },
      commission: c.agent?.commission ?? 0,
    },
  };
}

export interface VisitFlags {
  /** This customer's first sale at this shop in this period (day or month). */
  firstInPeriod: boolean;
  /** This customer's first sale at this shop ever. */
  newCustomer: boolean;
}

/** Add one event to a day or month doc. */
export function foldPeriod(
  doc: PeriodStats | undefined,
  storeUid: string,
  period: string,
  ev: StoreEvent,
  visit: VisitFlags | null,
  nowMs: number
): PeriodStats {
  const base = doc ?? emptyPeriod(storeUid, period);
  const cur: StatsCurrency = ev.currency;
  const c = normalizeCurrency(base.currencies?.[cur]);
  const customers = {
    unique: base.customers?.unique ?? 0,
    new: base.customers?.new ?? 0,
    returning: base.customers?.returning ?? 0,
  };
  let lastSaleAtMs = base.lastSaleAtMs;

  switch (ev.type) {
    case "sale": {
      const { hour } = localParts(ev.atMs);
      c.sales = {
        count: c.sales.count + 1,
        gross: c.sales.gross + ev.gross,
        fee: c.sales.fee + ev.fee,
        net: c.sales.net + ev.net,
      };
      c.hours.count[hour] += 1;
      c.hours.net[hour] += ev.net;
      c.channels[ev.channel] = {
        count: c.channels[ev.channel].count + 1,
        net: c.channels[ev.channel].net + ev.net,
      };
      if (visit?.firstInPeriod) {
        customers.unique += 1;
        if (visit.newCustomer) customers.new += 1;
      }
      customers.returning = customers.unique - customers.new;
      lastSaleAtMs = Math.max(lastSaleAtMs ?? 0, ev.atMs);
      break;
    }
    case "refund":
      c.refunds = {
        count: c.refunds.count + 1,
        gross: c.refunds.gross + ev.gross,
        fee: c.refunds.fee + ev.fee,
        net: c.refunds.net + ev.net,
      };
      break;
    case "cash_in":
      c.agent.cashIn = { count: c.agent.cashIn.count + 1, amount: c.agent.cashIn.amount + ev.amount };
      c.agent.commission += ev.commission;
      break;
    case "cash_out":
      c.agent.cashOut = { count: c.agent.cashOut.count + 1, amount: c.agent.cashOut.amount + ev.amount };
      c.agent.commission += ev.commission;
      break;
  }

  return {
    storeUid,
    period,
    currencies: { ...(base.currencies ?? {}), [cur]: c },
    customers,
    ...(lastSaleAtMs !== undefined ? { lastSaleAtMs } : {}),
    updatedAtMs: nowMs,
  };
}

/** Add a sale or refund to the customer's record at this shop. */
export function foldCustomer(
  doc: CustomerStats | undefined,
  ev: Extract<StoreEvent, { type: "sale" | "refund" }>,
  firstVisitToday: boolean,
  nowMs: number
): CustomerStats {
  const { day } = localParts(ev.atMs);
  const prev: CustomerStats = doc ?? {
    customerUid: ev.customerUid,
    firstSeenAtMs: ev.atMs,
    firstSeenDay: day,
    lastSeenAtMs: ev.atMs,
    lastSeenDay: day,
    visits: 0,
    visitDays: 0,
    spend: {},
    refunded: {},
    usualGapDays: null,
    spendUSD: 0,
    spendSLS: 0,
    updatedAtMs: nowMs,
  };

  if (ev.type === "refund") {
    const refunded = { ...prev.refunded, [ev.currency]: (prev.refunded?.[ev.currency] ?? 0) + ev.gross };
    return { ...prev, refunded, updatedAtMs: nowMs };
  }

  const spend = { ...prev.spend, [ev.currency]: (prev.spend?.[ev.currency] ?? 0) + ev.gross };
  let usualGapDays = prev.usualGapDays;
  // A new visit day after the last one: fold the gap in. An older day
  // arriving late (out-of-order delivery, catch-up) leaves the gap alone.
  if (doc && firstVisitToday && day > prev.lastSeenDay) {
    const gap = daysBetween(prev.lastSeenDay, day);
    usualGapDays = usualGapDays === null ? gap : Math.round((usualGapDays * (1 - GAP_WEIGHT) + gap * GAP_WEIGHT) * 10) / 10;
  }
  const later = ev.atMs > prev.lastSeenAtMs;
  const earlier = ev.atMs < prev.firstSeenAtMs;
  return {
    ...prev,
    firstSeenAtMs: earlier ? ev.atMs : prev.firstSeenAtMs,
    firstSeenDay: earlier ? day : prev.firstSeenDay,
    lastSeenAtMs: later ? ev.atMs : prev.lastSeenAtMs,
    lastSeenDay: later ? day : prev.lastSeenDay,
    visits: prev.visits + 1,
    visitDays: prev.visitDays + (firstVisitToday ? 1 : 0),
    spend,
    usualGapDays,
    spendUSD: spend.USD ?? 0,
    spendSLS: spend.SLS ?? 0,
    updatedAtMs: nowMs,
  };
}

/** "Amina Hassan Ali" → "Amina H." */
export function shortName(full: unknown): string | undefined {
  if (typeof full !== "string") return undefined;
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${Array.from(parts[1])[0]}.`;
}

export function foldRecent(doc: RecentFeed | undefined, item: RecentItem, nowMs: number): RecentFeed {
  const items = (doc?.items ?? []).filter((i) => i.txId !== item.txId);
  items.push(item);
  items.sort((a, b) => b.atMs - a.atMs);
  return { items: items.slice(0, RECENT_MAX), updatedAtMs: nowMs };
}

export function foldRoot(doc: StoreStatsRoot | undefined, ev: StoreEvent, nowMs: number): StoreStatsRoot {
  const { day } = localParts(ev.atMs);
  const later = !doc || ev.atMs >= doc.lastActivityAtMs;
  const lastSaleAtMs =
    ev.type === "sale" ? Math.max(doc?.lastSaleAtMs ?? 0, ev.atMs) : doc?.lastSaleAtMs;
  return {
    storeUid: ev.storeUid,
    firstActivityAtMs: Math.min(doc?.firstActivityAtMs ?? ev.atMs, ev.atMs),
    lastActivityAtMs: later ? ev.atMs : doc!.lastActivityAtMs,
    lastActivityDay: later ? day : doc!.lastActivityDay,
    ...(lastSaleAtMs !== undefined ? { lastSaleAtMs } : {}),
    updatedAtMs: nowMs,
  };
}

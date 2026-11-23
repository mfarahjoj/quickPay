/**
 * "Needs your attention": rules over what the dashboard already has, each
 * ending in one thing to do. Pure, recomputed on every live update.
 *
 * Every rule is quiet until it has enough history to be right: a new shop
 * sees fewer cards, never wrong ones.
 */

import { CustomerRow, Currency, StoreInfo } from "./types";
import { DayMap, heatmap, hourly, peakHours, summarize, totals, typicalDay } from "./stats";
import { addDays, dayRange } from "./time";

export type Severity = "urgent" | "opportunity" | "info";

export type InsightAction =
  /** Open a short checklist on the card itself. */
  | { kind: "checklist"; steps: string[] }
  /** Go to a part of the dashboard. */
  | { kind: "goto"; target: "hourly" | "heatmap" | "customers:lapsed" | "transactions:refunds" | `store:${string}` }
  /** Done in the merchant app, where money moves with the PIN. */
  | { kind: "phone"; where: string };

export interface Insight {
  /** Stable for the day, so a dismissal holds until tomorrow. */
  id: string;
  type:
    | "quiet_till"
    | "display_offline"
    | "refund_spike"
    | "pace_behind"
    | "pace_ahead"
    | "lapsed_regulars"
    | "idle_balance"
    | "peak_hours"
    | "store_behind";
  severity: Severity;
  /** On "All stores": which store the card is about. */
  storeName?: string;
  storeUid?: string;
  /** Raw values; the card formats them for the language and currency. */
  values: Record<string, number | string>;
  action: InsightAction;
}

export interface InsightInput {
  days: DayMap;
  today: string;
  hour: number;
  minute: number;
  nowMs: number;
  currency: Currency;
  store: StoreInfo | null;
  lapsed: CustomerRow[] | null;
  lastSaleAtMs: number | null;
}

/** Thresholds. Kept here, named, so they're easy to find and tune. */
export const RULES = {
  /** Expected sales in the last ~2 hours before a silent till is worth a look. */
  quietTillMinExpected: 3,
  /** Past weeks a "typical day" needs before pace or quiet-till cards speak. */
  minWeeks: 3,
  /** Today vs typical by this hour, in percent, before a pace card shows. */
  paceBehindPct: -25,
  paceAheadPct: 25,
  /** Typical sales by now before pace means anything. */
  paceMinTypicalSales: 5,
  refundSpikeMinCount: 2,
  refundSpikeShareOfSales: 0.1,
  refundSpikeTimesUsual: 3,
  /** Wallet balance worth paying out, in cents. */
  idleBalanceCents: 20000,
  peakMinSales: 20,
  displayOfflineAfterMs: 10 * 60 * 1000,
};

const ORDER: Record<Severity, number> = { urgent: 0, opportunity: 1, info: 2 };

export function computeInsights(input: InsightInput): Insight[] {
  const { days, today, hour, minute, nowMs, currency: c, store } = input;
  const out: Insight[] = [];
  const typical = typicalDay(days, today, c);
  const now = hourly(days, today, c);
  const tradingNow = typical.weeks >= RULES.minWeeks && (typical.count[hour] > 0 || (hour > 0 && typical.count[hour - 1] > 0));

  // A till that has gone silent in hours that are usually busy.
  if (typical.weeks >= RULES.minWeeks && hour >= 1) {
    const expected = typical.count[hour - 1] + typical.count[hour] * (minute / 60);
    const actual = now.count[hour - 1] + now.count[hour];
    const sinceMs = input.lastSaleAtMs ?? 0;
    if (expected >= RULES.quietTillMinExpected && actual === 0 && nowMs - sinceMs > 90 * 60 * 1000) {
      out.push({
        id: `quiet_till_${today}_${hour}`,
        type: "quiet_till",
        severity: "urgent",
        values: { expected: Math.round(expected), lastSaleAtMs: sinceMs },
        action: { kind: "checklist", steps: ["insight.quiet_till.step1", "insight.quiet_till.step2", "insight.quiet_till.step3"] },
      });
    }
  }

  // A counter display that dropped off while the shop trades.
  for (const d of store?.displays ?? []) {
    const away = d.lastSeenAtMs === null ? Infinity : nowMs - d.lastSeenAtMs;
    if (!d.online && away > RULES.displayOfflineAfterMs && tradingNow) {
      out.push({
        id: `display_offline_${d.name}_${today}`,
        type: "display_offline",
        severity: "urgent",
        values: { name: d.name, lastSeenAtMs: d.lastSeenAtMs ?? 0 },
        action: {
          kind: "checklist",
          steps: ["insight.display_offline.step1", "insight.display_offline.step2", "insight.display_offline.step3"],
        },
      });
    }
  }

  // Refunds well above usual today.
  const todayTotals = totals(days, [today], c);
  const usual = totals(days, dayRange(addDays(today, -1), 28), c);
  const usualRefundsPerDay = usual.refundGross / 28;
  if (
    todayTotals.refundCount >= RULES.refundSpikeMinCount &&
    todayTotals.refundGross > Math.max(RULES.refundSpikeShareOfSales * todayTotals.gross, RULES.refundSpikeTimesUsual * usualRefundsPerDay)
  ) {
    out.push({
      id: `refund_spike_${today}`,
      type: "refund_spike",
      severity: "urgent",
      values: { count: todayTotals.refundCount, amount: todayTotals.refundGross, currency: c },
      action: { kind: "goto", target: "transactions:refunds" },
    });
  }

  // Today against a typical same weekday, by this hour.
  if (typical.weeks >= RULES.minWeeks) {
    const sumTo = (a: number[]) => a.slice(0, hour + 1).reduce((x, y) => x + y, 0);
    const typicalSales = sumTo(typical.count);
    const typicalNet = sumTo(typical.net);
    const net = sumTo(now.net);
    if (typicalSales >= RULES.paceMinTypicalSales && typicalNet > 0) {
      const p = Math.round(((net - typicalNet) / typicalNet) * 100);
      if (p <= RULES.paceBehindPct || p >= RULES.paceAheadPct) {
        const behind = p < 0;
        out.push({
          id: `pace_${today}`,
          type: behind ? "pace_behind" : "pace_ahead",
          severity: "info",
          values: { pct: p, net, typicalNet, currency: c, weeks: typical.weeks },
          action: { kind: "goto", target: "hourly" },
        });
      }
    }
  }

  // Regulars who have stopped coming: who, and what they're worth.
  const lapsed = input.lapsed ?? [];
  if (lapsed.length > 0) {
    const value = lapsed.reduce((s, r) => s + (r.monthlyValue?.[c] ?? 0), 0);
    out.push({
      id: `lapsed_${today}`,
      type: "lapsed_regulars",
      severity: "opportunity",
      values: { count: lapsed.length, monthlyValue: value, currency: c, top: lapsed[0]?.name ?? "" },
      action: { kind: "goto", target: "customers:lapsed" },
    });
  }

  // Money sitting in the wallet with no automatic payout.
  if (store && store.balances && !store.autoPayout && store.balances.USD >= RULES.idleBalanceCents && store.accountType !== "agent_merchant") {
    out.push({
      id: `idle_balance_${today}`,
      type: "idle_balance",
      severity: "opportunity",
      values: { amount: store.balances.USD, currency: "USD" },
      action: { kind: "phone", where: "insight.idle_balance.where" },
    });
  }

  // When the shop is busy, over the last four weeks.
  const grid = heatmap(days, dayRange(today, 28), c);
  const peak = peakHours(grid);
  if (peak && peak.total >= RULES.peakMinSales) {
    out.push({
      id: `peak_${today}`,
      type: "peak_hours",
      severity: "info",
      values: { start: peak.peakStart, end: peak.peakStart + 3, share: peak.peakShare, weekday: peak.busiestWeekday, quiet: peak.quietHour ?? -1 },
      action: { kind: "goto", target: "heatmap" },
    });
  }

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/**
 * "All stores": every store's own cards that need doing (urgent and worth
 * doing; the good-to-know ones stay on each store's view), named by store,
 * and a card for any store whose last 7 days fell 25% or more against the
 * 7 before. Pure.
 */
export function groupInsights(
  stores: Array<{ storeUid: string; name: string; input: InsightInput }>,
  today: string,
  hour: number,
  currency: Currency
): Insight[] {
  const out: Insight[] = [];
  for (const s of stores) {
    for (const i of computeInsights(s.input)) {
      if (i.severity === "info") continue;
      out.push({ ...i, id: `${s.storeUid}_${i.id}`, storeName: s.name, storeUid: s.storeUid });
    }
    const t = summarize(s.input.days, today, hour, "7d", currency);
    if (t.previous.net > 0 && t.previous.count >= 10) {
      const pct = Math.round(((t.current.net - t.previous.net) / t.previous.net) * 100);
      if (pct <= -25) {
        out.push({
          id: `store_behind_${s.storeUid}_${today}`,
          type: "store_behind",
          severity: "opportunity",
          storeName: s.name,
          storeUid: s.storeUid,
          values: { pct, net: t.current.net, previous: t.previous.net, currency },
          action: { kind: "goto", target: `store:${s.storeUid}` },
        });
      }
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

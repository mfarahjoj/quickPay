/**
 * Everything the dashboard shows, computed from a shop's day docs. Pure.
 *
 * Comparisons are like for like: a period that ends today is set against the
 * one before it with that period's matching day cut at the same hour, using
 * the hourly sales buckets. Takings, sales and average sale are compared that
 * way; counts that have no hourly buckets (refunds, customers) compare whole
 * days and say so.
 */

import { addDays, dayRange, weekdayOf } from "./time";
import { Channel, CHANNELS, Currency, CurrencyPeriod, DayStats } from "./types";

export type Period = "today" | "7d" | "30d" | "90d";
export const PERIOD_DAYS: Record<Period, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };
/** Days the dashboard listens to: the longest period and the one before it. */
export const HISTORY_DAYS = 2 * PERIOD_DAYS["90d"];

export type DayMap = Map<string, DayStats>;

export interface Windows {
  current: string[];
  previous: string[];
}

export function windowsFor(today: string, period: Period): Windows {
  const n = PERIOD_DAYS[period];
  if (period === "today") return { current: [today], previous: [addDays(today, -7)] };
  return { current: dayRange(today, n), previous: dayRange(addDays(today, -n), n) };
}

const cur = (d: DayStats | undefined, c: Currency): CurrencyPeriod | undefined => d?.currencies?.[c];

export interface Totals {
  net: number;
  gross: number;
  fee: number;
  count: number;
  refundCount: number;
  refundGross: number;
  refundNet: number;
  commission: number;
  cashInCount: number;
  cashOutCount: number;
  /** Sum of each day's distinct customers: visits, counting a customer once a day. */
  visits: number;
  newCustomers: number;
  returningVisits: number;
  channels: Record<Channel, { count: number; net: number }>;
}

function emptyTotals(): Totals {
  const channels = {} as Totals["channels"];
  for (const ch of CHANNELS) channels[ch] = { count: 0, net: 0 };
  return {
    net: 0,
    gross: 0,
    fee: 0,
    count: 0,
    refundCount: 0,
    refundGross: 0,
    refundNet: 0,
    commission: 0,
    cashInCount: 0,
    cashOutCount: 0,
    visits: 0,
    newCustomers: 0,
    returningVisits: 0,
    channels,
  };
}

/**
 * Add up days. `cut` limits one day's sales to the hours up to and including
 * `hour`: the same-hour comparison for a period that ends now.
 */
export function totals(days: DayMap, keys: string[], c: Currency, cut?: { day: string; hour: number }): Totals {
  const t = emptyTotals();
  for (const key of keys) {
    const d = days.get(key);
    const p = cur(d, c);
    if (d) {
      t.visits += d.customers?.unique ?? 0;
      t.newCustomers += d.customers?.new ?? 0;
      t.returningVisits += d.customers?.returning ?? 0;
    }
    if (!p) continue;
    if (cut && cut.day === key) {
      for (let h = 0; h <= cut.hour; h++) {
        t.net += p.hours.net[h] ?? 0;
        t.count += p.hours.count[h] ?? 0;
      }
    } else {
      t.net += p.sales.net;
      t.count += p.sales.count;
    }
    t.gross += p.sales.gross;
    t.fee += p.sales.fee;
    t.refundCount += p.refunds.count;
    t.refundGross += p.refunds.gross;
    t.refundNet += p.refunds.net;
    t.commission += p.agent.commission;
    t.cashInCount += p.agent.cashIn.count;
    t.cashOutCount += p.agent.cashOut.count;
    for (const ch of CHANNELS) {
      t.channels[ch].count += p.channels?.[ch]?.count ?? 0;
      t.channels[ch].net += p.channels?.[ch]?.net ?? 0;
    }
  }
  return t;
}

/** Percent change, or null when there is nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface Summary {
  current: Totals;
  /** The period before, its matching day cut at the current hour for net and count. */
  previous: Totals;
  averageSale: number;
  previousAverageSale: number;
}

export function summarize(days: DayMap, today: string, hour: number, period: Period, c: Currency): Summary {
  const w = windowsFor(today, period);
  const current = totals(days, w.current, c);
  const matching = w.previous[w.previous.length - 1];
  const previous = totals(days, w.previous, c, { day: matching, hour });
  return {
    current,
    previous,
    averageSale: current.count ? Math.round(current.net / current.count) : 0,
    previousAverageSale: previous.count ? Math.round(previous.net / previous.count) : 0,
  };
}

export interface DayPoint {
  day: string;
  net: number;
  count: number;
}

export function dailySeries(days: DayMap, keys: string[], c: Currency): DayPoint[] {
  return keys.map((day) => {
    const p = cur(days.get(day), c);
    return { day, net: p?.sales.net ?? 0, count: p?.sales.count ?? 0 };
  });
}

export function hourly(days: DayMap, day: string, c: Currency): { net: number[]; count: number[] } {
  const p = cur(days.get(day), c);
  return { net: p?.hours.net.slice() ?? new Array(24).fill(0), count: p?.hours.count.slice() ?? new Array(24).fill(0) };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface Typical {
  /** Median of each hour over the same weekday in past weeks. */
  net: number[];
  count: number[];
  /** Past same weekdays that went into it. */
  weeks: number;
}

/**
 * A typical {weekday} for this shop: the median, hour by hour, of the same
 * weekday over up to `weeks` past weeks. Weeks before the shop's first sale
 * are left out, so a new shop isn't compared with days it didn't trade.
 */
export function typicalDay(days: DayMap, today: string, c: Currency, weeks = 8): Typical {
  const firstDay = [...days.keys()].filter((k) => cur(days.get(k), c)?.sales.count).sort()[0];
  const past = Array.from({ length: weeks }, (_, i) => addDays(today, -7 * (i + 1))).filter(
    (d) => firstDay !== undefined && d >= firstDay
  );
  const net = new Array(24).fill(0);
  const count = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    net[h] = Math.round(median(past.map((d) => cur(days.get(d), c)?.hours.net[h] ?? 0)));
    count[h] = median(past.map((d) => cur(days.get(d), c)?.hours.count[h] ?? 0));
  }
  return { net, count, weeks: past.length };
}

const sum = (a: number[], to = a.length - 1) => a.slice(0, to + 1).reduce((x, y) => x + y, 0);

export interface Pace {
  /** Today so far, and a typical same weekday by the same hour. */
  net: number;
  typicalNet: number;
  pct: number | null;
  /** Typical whole-day takings, for "on course for …". */
  typicalDayNet: number;
}

export function pace(days: DayMap, today: string, hour: number, c: Currency): Pace & { weeks: number } {
  const t = typicalDay(days, today, c);
  const now = hourly(days, today, c);
  const net = sum(now.net, hour);
  const typicalNet = sum(t.net, hour);
  return { net, typicalNet, pct: change(net, typicalNet), typicalDayNet: sum(t.net), weeks: t.weeks };
}

/** Sales by weekday (rows, Sunday first) and hour (columns), over the days given. */
export function heatmap(days: DayMap, keys: string[], c: Currency): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const day of keys) {
    const p = cur(days.get(day), c);
    if (!p) continue;
    const w = weekdayOf(day);
    for (let h = 0; h < 24; h++) grid[w][h] += p.hours.count[h] ?? 0;
  }
  return grid;
}

export interface PeakHours {
  total: number;
  /** The busiest three hours in a row, by sales. */
  peakStart: number;
  peakShare: number;
  busiestWeekday: number;
  /** The quietest hour inside the shop's trading hours, or null. */
  quietHour: number | null;
}

export function peakHours(grid: number[][]): PeakHours | null {
  const byHour = new Array(24).fill(0);
  const byWeekday = grid.map((row) => sum(row));
  for (const row of grid) row.forEach((n, h) => (byHour[h] += n));
  const total = sum(byHour);
  if (total === 0) return null;
  let peakStart = 0;
  let best = -1;
  for (let h = 0; h <= 21; h++) {
    const block = byHour[h] + byHour[h + 1] + byHour[h + 2];
    if (block > best) {
      best = block;
      peakStart = h;
    }
  }
  // Trading hours: from the first to the last hour with sales.
  const open = byHour.findIndex((n) => n > 0);
  const close = 23 - [...byHour].reverse().findIndex((n) => n > 0);
  let quietHour: number | null = null;
  if (close - open >= 4) {
    for (let h = open + 1; h < close; h++) {
      if (quietHour === null || byHour[h] < byHour[quietHour]) quietHour = h;
    }
  }
  return {
    total,
    peakStart,
    peakShare: Math.round((best / total) * 100),
    busiestWeekday: byWeekday.indexOf(Math.max(...byWeekday)),
    quietHour,
  };
}

export function channelMix(t: Totals): Array<{ channel: Channel; count: number; net: number; share: number }> {
  const total = CHANNELS.reduce((s, ch) => s + t.channels[ch].net, 0);
  return CHANNELS.map((channel) => ({
    channel,
    count: t.channels[channel].count,
    net: t.channels[channel].net,
    share: total ? Math.round((t.channels[channel].net / total) * 100) : 0,
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.net - a.net);
}

export interface CustomerPoint {
  day: string;
  new: number;
  returning: number;
}

export function customerSeries(days: DayMap, keys: string[]): CustomerPoint[] {
  return keys.map((day) => {
    const d = days.get(day);
    return { day, new: d?.customers?.new ?? 0, returning: d?.customers?.returning ?? 0 };
  });
}

/** The most recent sale in any currency, for the live dot. */
export function lastSaleAt(days: DayMap): number | null {
  let best: number | null = null;
  for (const d of days.values()) if (d.lastSaleAtMs && (best === null || d.lastSaleAtMs > best)) best = d.lastSaleAtMs;
  return best;
}

/** Whether the shop has ever taken this currency in the days loaded. */
export function usesCurrency(days: DayMap, c: Currency): boolean {
  for (const d of days.values()) {
    const p = cur(d, c);
    if (p && (p.sales.count || p.refunds.count || p.agent.cashIn.count || p.agent.cashOut.count)) return true;
  }
  return false;
}

export function isAgent(days: DayMap): boolean {
  for (const d of days.values()) {
    for (const c of ["USD", "SLS"] as Currency[]) {
      const p = cur(d, c);
      if (p && (p.agent.cashIn.count || p.agent.cashOut.count)) return true;
    }
  }
  return false;
}

/**
 * Several stores' days as one shop's, for "All stores": every count and amount
 * summed per currency (dollars and shillings still apart). Distinct customers
 * become customer visits per store: a customer of two stores counts twice.
 */
export function mergeDays(maps: DayMap[]): DayMap {
  const out: DayMap = new Map();
  const add = (a: number[] | undefined, b: number[] | undefined) => Array.from({ length: 24 }, (_, h) => (a?.[h] ?? 0) + (b?.[h] ?? 0));
  for (const m of maps) {
    for (const [day, d] of m) {
      const prev = out.get(day);
      if (!prev) {
        out.set(day, JSON.parse(JSON.stringify(d)));
        continue;
      }
      for (const c of ["USD", "SLS"] as Currency[]) {
        const x = prev.currencies[c];
        const y = d.currencies[c];
        if (!y) continue;
        if (!x) {
          prev.currencies[c] = JSON.parse(JSON.stringify(y));
          continue;
        }
        for (const k of ["sales", "refunds"] as const) {
          x[k] = { count: x[k].count + y[k].count, gross: x[k].gross + y[k].gross, fee: x[k].fee + y[k].fee, net: x[k].net + y[k].net };
        }
        x.hours = { count: add(x.hours.count, y.hours.count), net: add(x.hours.net, y.hours.net) };
        for (const ch of CHANNELS) {
          x.channels[ch] = {
            count: (x.channels?.[ch]?.count ?? 0) + (y.channels?.[ch]?.count ?? 0),
            net: (x.channels?.[ch]?.net ?? 0) + (y.channels?.[ch]?.net ?? 0),
          };
        }
        x.agent = {
          cashIn: { count: x.agent.cashIn.count + y.agent.cashIn.count, amount: x.agent.cashIn.amount + y.agent.cashIn.amount },
          cashOut: { count: x.agent.cashOut.count + y.agent.cashOut.count, amount: x.agent.cashOut.amount + y.agent.cashOut.amount },
          commission: x.agent.commission + y.agent.commission,
        };
      }
      prev.customers = {
        unique: prev.customers.unique + d.customers.unique,
        new: prev.customers.new + d.customers.new,
        returning: prev.customers.returning + d.customers.returning,
      };
      prev.lastSaleAtMs = Math.max(prev.lastSaleAtMs ?? 0, d.lastSaleAtMs ?? 0) || undefined;
    }
  }
  return out;
}

export interface StoreRow {
  storeUid: string;
  name: string;
  net: number;
  count: number;
  averageSale: number;
  change: number | null;
  lastSaleAtMs: number | null;
}

/** One row per store for the comparison table, like-for-like as summarize(). */
export function compareStores(
  stores: Array<{ storeUid: string; name: string; days: DayMap }>,
  today: string,
  hour: number,
  period: Period,
  c: Currency
): StoreRow[] {
  return stores
    .map(({ storeUid, name, days }) => {
      const s = summarize(days, today, hour, period, c);
      return {
        storeUid,
        name,
        net: s.current.net,
        count: s.current.count,
        averageSale: s.averageSale,
        change: change(s.current.net, s.previous.net),
        lastSaleAtMs: lastSaleAt(days),
      };
    })
    .sort((a, b) => b.net - a.net);
}

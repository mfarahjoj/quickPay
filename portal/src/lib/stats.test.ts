import { describe, expect, it } from "vitest";
import { addDays, dayRange, dayStartMs, localParts, weekdayOf } from "./time";
import { money as m, moneyShort as ms, pct as p, plain } from "./format";
const money = (a: number, c: Currency) => plain(m(a, c));
const moneyShort = (a: number, c: Currency) => plain(ms(a, c));
const pct = (n: number) => plain(p(n));
import { change, channelMix, customerSeries, DayMap, heatmap, pace, peakHours, summarize, totals, typicalDay, usesCurrency } from "./stats";
import { computeInsights, InsightInput } from "./insights";
import { CHANNELS, Currency, CurrencyPeriod, CustomerRow, DayStats, StoreInfo } from "./types";

/** A day doc with sales at the given hours ({hour: [count, net]}). */
function dayDoc(day: string, hours: Record<number, [number, number]>, extra: Partial<CurrencyPeriod> = {}, c: Currency = "USD"): DayStats {
  const count = new Array(24).fill(0);
  const net = new Array(24).fill(0);
  let n = 0;
  let total = 0;
  for (const [h, [k, v]] of Object.entries(hours)) {
    count[+h] = k;
    net[+h] = v;
    n += k;
    total += v;
  }
  const channels = Object.fromEntries(CHANNELS.map((ch) => [ch, { count: 0, net: 0 }])) as CurrencyPeriod["channels"];
  channels.sale_qr = { count: n, net: total };
  return {
    storeUid: "s",
    period: day,
    currencies: {
      [c]: {
        sales: { count: n, gross: Math.round(total / 0.99), fee: Math.round(total / 0.99) - total, net: total },
        refunds: { count: 0, gross: 0, fee: 0, net: 0 },
        hours: { count, net },
        channels,
        agent: { cashIn: { count: 0, amount: 0 }, cashOut: { count: 0, amount: 0 }, commission: 0 },
        ...extra,
      },
    },
    customers: { unique: n, new: 1, returning: Math.max(0, n - 1) },
    updatedAtMs: 0,
  };
}

const TODAY = "2026-11-18"; // a Wednesday

function history(weeks: number, hours: Record<number, [number, number]>): DayMap {
  const m: DayMap = new Map();
  for (let w = 1; w <= weeks; w++) {
    const d = addDays(TODAY, -7 * w);
    m.set(d, dayDoc(d, hours));
  }
  return m;
}

describe("time and format", () => {
  it("keeps Hargeisa's calendar", () => {
    expect(localParts(Date.UTC(2026, 10, 18, 20, 59))).toMatchObject({ day: "2026-11-18", hour: 23 });
    expect(localParts(Date.UTC(2026, 10, 18, 21, 0))).toMatchObject({ day: "2026-11-19", hour: 0 });
    expect(weekdayOf(TODAY)).toBe(3);
    expect(dayRange(TODAY, 3)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(dayStartMs(TODAY)).toBe(Date.UTC(2026, 10, 17, 21, 0));
  });

  it("writes money as the app does", () => {
    expect(money(123450, "USD")).toBe("$1,234.50");
    expect(money(30000, "SLS")).toBe("30,000 SLSH");
    expect(moneyShort(1290000, "USD")).toBe("$12.9K");
    expect(moneyShort(84000, "USD")).toBe("$840");
    expect(moneyShort(4250, "USD")).toBe("$42.50");
    expect(moneyShort(1250000, "SLS")).toBe("1.3M SLSH");
    expect(pct(12)).toBe("+12%");
    expect(pct(-4)).toBe("-4%");
  });
});

describe("summaries", () => {
  it("compares today with last week's same day by the same hour", () => {
    const days: DayMap = new Map([
      [TODAY, dayDoc(TODAY, { 9: [2, 2000], 10: [1, 1000] })],
      [addDays(TODAY, -7), dayDoc(addDays(TODAY, -7), { 9: [1, 1000], 10: [1, 1000], 18: [10, 50000] })],
    ]);
    const s = summarize(days, TODAY, 10, "today", "USD");
    expect(s.current).toMatchObject({ net: 3000, count: 3 });
    // Last Wednesday up to 10:59 only, not its evening rush.
    expect(s.previous).toMatchObject({ net: 2000, count: 2 });
    expect(change(s.current.net, s.previous.net)).toBe(50);
    expect(s.averageSale).toBe(1000);
  });

  it("never adds dollars and shillings", () => {
    const days: DayMap = new Map([[TODAY, dayDoc(TODAY, { 9: [1, 1000] })]]);
    days.get(TODAY)!.currencies.SLS = dayDoc(TODAY, { 9: [1, 60000] }, {}, "SLS").currencies.SLS;
    expect(totals(days, [TODAY], "USD").net).toBe(1000);
    expect(totals(days, [TODAY], "SLS").net).toBe(60000);
    expect(usesCurrency(days, "SLS")).toBe(true);
    expect(usesCurrency(new Map([[TODAY, dayDoc(TODAY, { 9: [1, 1] })]]), "SLS")).toBe(false);
  });

  it("finds a typical weekday, ignoring weeks before the shop opened", () => {
    const days = history(3, { 9: [2, 2000], 12: [4, 4000] });
    const t = typicalDay(days, TODAY, "USD");
    expect(t.weeks).toBe(3);
    expect(t.count[12]).toBe(4);
    expect(t.net[9]).toBe(2000);
    days.set(TODAY, dayDoc(TODAY, { 9: [1, 1000] }));
    expect(pace(days, TODAY, 9, "USD")).toMatchObject({ net: 1000, typicalNet: 2000, pct: -50, typicalDayNet: 6000 });
  });

  it("maps busy hours and names the peak", () => {
    const days: DayMap = new Map();
    for (const d of dayRange(TODAY, 14)) days.set(d, dayDoc(d, { 8: [1, 100], 12: [1, 100], 17: [5, 500], 18: [6, 600], 19: [4, 400] }));
    const grid = heatmap(days, dayRange(TODAY, 14), "USD");
    expect(grid[3][18]).toBe(12); // two Wednesdays
    const peak = peakHours(grid)!;
    expect(peak).toMatchObject({ peakStart: 17, peakShare: 88 });
    expect(peak.quietHour).toBe(9);
    expect(peakHours(heatmap(new Map(), [], "USD"))).toBeNull();
  });

  it("ranks channels and splits new from returning customers", () => {
    const d = dayDoc(TODAY, { 9: [3, 3000] });
    d.currencies.USD!.channels.sticker = { count: 2, net: 5000 };
    const mix = channelMix(totals(new Map([[TODAY, d]]), [TODAY], "USD"));
    expect(mix.map((m) => m.channel)).toEqual(["sticker", "sale_qr"]);
    expect(mix[0].share).toBe(63);
    expect(customerSeries(new Map([[TODAY, d]]), [TODAY])).toEqual([{ day: TODAY, new: 1, returning: 2 }]);
  });
});

describe("insights", () => {
  const store = (over: Partial<StoreInfo> = {}): StoreInfo => ({
    storeUid: "s",
    name: "Hodan's Shop",
    area: null,
    businessType: null,
    accountType: "merchant",
    autoPayout: false,
    balances: { USD: 0, SLS: 0 },
    displays: [],
    ...over,
  });
  const at = (hour: number, minute = 30) => Date.UTC(2026, 10, 18, hour - 3, minute);
  const input = (days: DayMap, hour: number, over: Partial<InsightInput> = {}): InsightInput => ({
    days,
    today: TODAY,
    hour,
    minute: 30,
    nowMs: at(hour),
    currency: "USD",
    store: store(),
    lapsed: [],
    lastSaleAtMs: null,
    ...over,
  });
  const types = (xs: { type: string }[]) => xs.map((x) => x.type);

  it("says nothing about a new shop", () => {
    expect(computeInsights(input(new Map(), 12))).toEqual([]);
  });

  it("flags a silent till in usually busy hours, with what to check", () => {
    const days = history(4, { 11: [4, 4000], 12: [4, 4000] });
    days.set(TODAY, dayDoc(TODAY, { 9: [1, 1000] }));
    const out = computeInsights(input(days, 12, { lastSaleAtMs: at(9) }));
    const quiet = out.find((i) => i.type === "quiet_till")!;
    expect(quiet).toMatchObject({ severity: "urgent", values: { expected: 6 } });
    expect(quiet.action.kind).toBe("checklist");
    // A sale in the last hour: nothing to flag.
    days.set(TODAY, dayDoc(TODAY, { 11: [1, 1000] }));
    expect(types(computeInsights(input(days, 12, { lastSaleAtMs: at(11) })))).not.toContain("quiet_till");
  });

  it("flags an offline counter display only while the shop trades", () => {
    const days = history(4, { 12: [4, 4000] });
    const offline = store({ displays: [{ name: "Front", online: false, lastSeenAtMs: at(11) }] });
    expect(types(computeInsights(input(days, 12, { store: offline })))).toContain("display_offline");
    expect(types(computeInsights(input(days, 3, { store: offline })))).not.toContain("display_offline");
  });

  it("calls a refund spike against the shop's usual", () => {
    const days = history(4, { 12: [4, 4000] });
    days.set(TODAY, dayDoc(TODAY, { 9: [10, 10000] }, { refunds: { count: 3, gross: 3000, fee: 30, net: 2970 } }));
    const spike = computeInsights(input(days, 12)).find((i) => i.type === "refund_spike")!;
    expect(spike).toMatchObject({ severity: "urgent", values: { count: 3, amount: 3000 } });
    expect(spike.action).toEqual({ kind: "goto", target: "transactions:refunds" });
  });

  it("reports pace either way once there's history", () => {
    const days = history(4, { 9: [3, 3000], 10: [3, 3000] });
    days.set(TODAY, dayDoc(TODAY, { 9: [1, 1000], 10: [1, 1000] }));
    expect(computeInsights(input(days, 10, { lastSaleAtMs: at(10) })).find((i) => i.type === "pace_behind")?.values.pct).toBe(-67);
    days.set(TODAY, dayDoc(TODAY, { 9: [5, 5000], 10: [5, 5000] }));
    expect(types(computeInsights(input(days, 10, { lastSaleAtMs: at(10) })))).toContain("pace_ahead");
    // Two weeks of history is not enough to call it.
    const young = history(2, { 9: [3, 3000], 10: [3, 3000] });
    young.set(TODAY, dayDoc(TODAY, { 9: [1, 1000] }));
    expect(types(computeInsights(input(young, 10)))).not.toContain("pace_behind");
  });

  it("puts gone-quiet regulars and idle money in front, most urgent first", () => {
    const lapsed = [{ name: "Amina Yusuf", monthlyValue: { USD: 4000, SLS: 0 } }, { name: "Bashir", monthlyValue: { USD: 1000, SLS: 0 } }] as CustomerRow[];
    const days = history(4, { 11: [4, 4000], 12: [4, 4000] });
    const out = computeInsights(
      input(days, 12, { lapsed, store: store({ balances: { USD: 50000, SLS: 0 } }), lastSaleAtMs: at(8) })
    );
    expect(out.find((i) => i.type === "lapsed_regulars")!.values).toMatchObject({ count: 2, monthlyValue: 5000, top: "Amina Yusuf" });
    expect(out.find((i) => i.type === "idle_balance")!.action.kind).toBe("phone");
    expect(out.map((i) => i.severity)).toEqual([...out.map((i) => i.severity)].sort((a, b) => ["urgent", "opportunity", "info"].indexOf(a) - ["urgent", "opportunity", "info"].indexOf(b)));
    expect(out[0].type).toBe("quiet_till");
    // Auto payout on: no idle-money card.
    expect(types(computeInsights(input(days, 12, { store: store({ autoPayout: true, balances: { USD: 50000, SLS: 0 } }) })))).not.toContain("idle_balance");
  });
});

describe("several stores", () => {
  const storeDays = (salesPerDay: number, weeks = 2): DayMap => {
    const m: DayMap = new Map();
    for (const d of dayRange(TODAY, weeks * 7)) m.set(d, dayDoc(d, { 12: [salesPerDay, salesPerDay * 1000] }));
    return m;
  };

  it("adds stores up per currency, never across", async () => {
    const { mergeDays } = await import("./stats");
    const a: DayMap = new Map([[TODAY, dayDoc(TODAY, { 9: [2, 2000] })]]);
    const b: DayMap = new Map([[TODAY, dayDoc(TODAY, { 9: [1, 500], 18: [1, 700] })]]);
    b.get(TODAY)!.currencies.SLS = dayDoc(TODAY, { 9: [1, 60000] }, {}, "SLS").currencies.SLS;
    const all = mergeDays([a, b]);
    expect(totals(all, [TODAY], "USD")).toMatchObject({ count: 4, net: 3200 });
    expect(totals(all, [TODAY], "SLS")).toMatchObject({ count: 1, net: 60000 });
    expect(all.get(TODAY)!.currencies.USD!.hours.count[9]).toBe(3);
    // The inputs are untouched.
    expect(totals(a, [TODAY], "USD").count).toBe(2);
  });

  it("compares stores like for like, best first", async () => {
    const { compareStores } = await import("./stats");
    const rows = compareStores(
      [
        { storeUid: "a", name: "Small", days: storeDays(1) },
        { storeUid: "b", name: "Big", days: storeDays(5) },
      ],
      TODAY,
      23,
      "7d",
      "USD"
    );
    expect(rows.map((r) => r.name)).toEqual(["Big", "Small"]);
    expect(rows[0]).toMatchObject({ net: 35000, count: 35, averageSale: 1000, change: 0 });
  });

  it("names the store a card is about, and flags a store that fell behind", async () => {
    const { groupInsights } = await import("./insights");
    const falling = storeDays(5);
    for (const d of dayRange(TODAY, 7)) falling.set(d, dayDoc(d, { 12: [2, 2000] }));
    const base = { today: TODAY, hour: 23, minute: 0, nowMs: Date.UTC(2026, 10, 18, 20), currency: "USD" as Currency, lapsed: null, lastSaleAtMs: null };
    const shop = (uid: string, over: Partial<StoreInfo> = {}): StoreInfo => ({ storeUid: uid, name: uid, area: null, businessType: null, accountType: "merchant", autoPayout: true, balances: { USD: 0, SLS: 0 }, displays: [], ...over });
    const out = groupInsights(
      [
        { storeUid: "a", name: "Jigjiga Yar", input: { ...base, days: storeDays(5), store: shop("a", { autoPayout: false, balances: { USD: 50000, SLS: 0 } }) } },
        { storeUid: "b", name: "26 June", input: { ...base, days: falling, store: shop("b") } },
      ],
      TODAY,
      23,
      "USD"
    );
    const behind = out.find((i) => i.type === "store_behind")!;
    expect(behind).toMatchObject({ storeName: "26 June", values: { pct: -60 }, action: { kind: "goto", target: "store:b" } });
    expect(out.find((i) => i.type === "idle_balance")).toMatchObject({ storeName: "Jigjiga Yar", id: "a_idle_balance_2026-11-18" });
    // Good-to-know cards stay on each store's own view.
    expect(out.every((i) => i.severity !== "info")).toBe(true);
  });
});

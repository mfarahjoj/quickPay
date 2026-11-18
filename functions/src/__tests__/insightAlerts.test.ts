import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";

jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

import { notifyUser } from "../utils/notifications";
import { computeAlerts, runInsightAlerts, AlertInput } from "../insights/alerts";
import { addDays } from "../merchantStats/time";
import { PeriodStats } from "../merchantStats/types";

const TODAY = "2026-11-18"; // Wednesday
const at = (hour: number, minute = 30) => Date.UTC(2026, 10, 18, hour - 3, minute);

function day(d: string, hours: Record<number, number>, refunds = { count: 0, gross: 0 }, salesGross = 0): PeriodStats {
  const count = new Array(24).fill(0);
  let n = 0;
  for (const [h, k] of Object.entries(hours)) {
    count[+h] = k;
    n += k;
  }
  return {
    storeUid: "s",
    period: d,
    currencies: {
      USD: {
        sales: { count: n, gross: salesGross || n * 1000, fee: 0, net: n * 1000 },
        refunds: { ...refunds, fee: 0, net: refunds.gross },
        hours: { count, net: count.map((k) => k * 1000) },
        channels: {} as never,
        agent: { cashIn: { count: 0, amount: 0 }, cashOut: { count: 0, amount: 0 }, commission: 0 },
      },
    },
    customers: { unique: n, new: 0, returning: n },
    updatedAtMs: 0,
  };
}

function history(weeks: number, hours: Record<number, number>): Map<string, PeriodStats> {
  const m = new Map<string, PeriodStats>();
  for (let w = 1; w <= weeks; w++) m.set(addDays(TODAY, -7 * w), day(addDays(TODAY, -7 * w), hours));
  return m;
}

const input = (days: Map<string, PeriodStats>, hour: number, over: Partial<AlertInput> = {}): AlertInput => ({
  days,
  today: TODAY,
  hour,
  minute: 30,
  nowMs: at(hour),
  lastSaleAtMs: null,
  displays: [],
  ...over,
});

describe("insight alert rules (the dashboard's)", () => {
  it("say nothing without three weeks of history", () => {
    expect(computeAlerts(input(history(2, { 11: 4, 12: 4 }), 12))).toEqual([]);
  });

  it("call a silent till in usually busy hours, and not a quiet hour", () => {
    const days = history(4, { 11: 4, 12: 4 });
    expect(computeAlerts(input(days, 12, { lastSaleAtMs: at(9) }))).toEqual([{ type: "quiet_till", values: { expected: 6, lastSaleAtMs: at(9) } }]);
    expect(computeAlerts(input(days, 16, { lastSaleAtMs: at(9) }))).toEqual([]);
    days.set(TODAY, day(TODAY, { 11: 1 }));
    expect(computeAlerts(input(days, 12, { lastSaleAtMs: at(11) }))).toEqual([]);
  });

  it("call an offline counter display only while trading", () => {
    const days = history(4, { 12: 4 });
    const displays = [{ name: "Front", online: false, lastSeenAtMs: at(11) }];
    expect(computeAlerts(input(days, 12, { displays, lastSaleAtMs: at(12, 10) })).map((a) => a.type)).toEqual(["display_offline"]);
    expect(computeAlerts(input(days, 3, { displays }))).toEqual([]);
  });

  it("call a refund spike against the usual", () => {
    const days = history(4, { 12: 4 });
    days.set(TODAY, day(TODAY, { 9: 10 }, { count: 3, gross: 3000 }, 10000));
    expect(computeAlerts(input(days, 12, { lastSaleAtMs: at(12, 10) }))).toEqual([
      { type: "refund_spike", values: { count: 3, amount: 3000, currency: "USD" } },
    ]);
  });
});

describe("runInsightAlerts", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  it("pushes each alert once a day, to shops only", async () => {
    const seed: Record<string, any> = {
      "users/shop": { accountType: "merchant" },
      "users/cust": { accountType: "customer" },
      "merchantStats/shop": { storeUid: "shop", lastActivityDay: TODAY, lastSaleAtMs: at(9) },
      "merchantStats/cust": { storeUid: "cust", lastActivityDay: TODAY, lastSaleAtMs: at(9) },
    };
    for (let w = 1; w <= 4; w++) {
      const d = addDays(TODAY, -7 * w);
      seed[`merchantStats/shop/days/${d}`] = day(d, { 11: 4, 12: 4 });
      seed[`merchantStats/cust/days/${d}`] = day(d, { 11: 4, 12: 4 });
    }
    const db = fakeFirestore(seed);
    restore = useFakeFirestore(db);
    (notifyUser as jest.Mock).mockClear();

    await expect(runInsightAlerts(at(12), db as any)).resolves.toEqual({ shops: 2, pushed: 1 });
    expect(notifyUser).toHaveBeenCalledWith(
      "shop",
      "insight_alert",
      { key: "insight.quiet_till", params: { time: new Date(at(9)) } },
      { type: "insight_alert", insight: "quiet_till" }
    );
    // An hour later the till is still quiet: no second push today.
    await expect(runInsightAlerts(at(13), db as any)).resolves.toEqual({ shops: 2, pushed: 0 });
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(db.get(`merchantInsights/shop/alerts/quiet_till_${TODAY}`)).toMatchObject({ type: "quiet_till", day: TODAY });
    void admin;
  });
});

import * as admin from "firebase-admin";
import { fakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import { classifyTransaction, saleChannel, statsCurrency } from "../merchantStats/classify";
import { addDays, dayBounds, daysBetween, localParts } from "../merchantStats/time";
import { applyStoreEvent } from "../merchantStats/apply";
import { foldCustomer, shortName } from "../merchantStats/fold";
import { becameCompleted } from "../merchantStats/triggers";
import { backfillStep, catchUp, checkDay, diffDay, eventsCompletedBetween, runMerchantStatsNightly } from "../merchantStats/nightly";
import { PeriodStats, StoreEvent } from "../merchantStats/types";

const T = (ms: number) => admin.firestore.Timestamp.fromMillis(ms);
// 2026-11-18 09:00 in Hargeisa (UTC+3) is 06:00 UTC.
const NOV18_0900 = Date.UTC(2026, 10, 18, 6, 0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const SHOP = "shop-1";
const AMINA = "cust-amina";
const BASHIR = "cust-bashir";

function sale(over: Record<string, unknown> = {}) {
  return {
    type: "payment",
    kind: "merchant_payment",
    fromUserId: AMINA,
    toUserId: SHOP,
    participants: [AMINA, SHOP],
    amount: 1000,
    feeCents: 10,
    netCents: 990,
    currency: "USD",
    status: "completed",
    journalEntryId: "qrpay_qr1",
    createdAt: T(NOV18_0900),
    completedAt: T(NOV18_0900),
    ...over,
  };
}

const ev = (txId: string, row: Record<string, unknown>) => classifyTransaction(txId, row as any)!;

describe("merchantStats time", () => {
  it("buckets by Hargeisa local day and hour", () => {
    expect(localParts(NOV18_0900)).toEqual({ day: "2026-11-18", month: "2026-11", hour: 9, weekday: 3 });
    // 20:59 UTC is 23:59 local; 21:00 UTC is midnight, the next day.
    expect(localParts(Date.UTC(2026, 10, 18, 20, 59)).day).toBe("2026-11-18");
    expect(localParts(Date.UTC(2026, 10, 18, 21, 0))).toMatchObject({ day: "2026-11-19", hour: 0 });
  });

  it("gives a local day's bounds and walks days across months", () => {
    expect(dayBounds("2026-11-18")).toEqual({
      startMs: Date.UTC(2026, 10, 17, 21, 0),
      endMs: Date.UTC(2026, 10, 18, 21, 0),
    });
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-18", "2026-12-02")).toBe(14);
  });
});

describe("classifyTransaction", () => {
  it("reads a shop payment as a sale for the receiver", () => {
    expect(classifyTransaction("t1", sale() as any)).toEqual({
      type: "sale",
      txId: "t1",
      storeUid: SHOP,
      customerUid: AMINA,
      currency: "USD",
      atMs: NOV18_0900,
      gross: 1000,
      fee: 10,
      net: 990,
      channel: "sale_qr",
    });
  });

  it("tells channels apart by journal entry", () => {
    expect(saleChannel({ journalEntryId: "qrpay_x" })).toEqual({ channel: "sale_qr" });
    expect(saleChannel({ journalEntryId: "paymerchant_x" })).toEqual({ channel: "sticker" });
    expect(saleChannel({ journalEntryId: "custqr_req9" })).toEqual({ channel: "scan", requestId: "req9" });
    expect(saleChannel({ journalEntryId: "apicharge_c1" })).toEqual({ channel: "online" });
    const online = ev("t", sale({ kind: "online_payment", journalEntryId: "apicharge_c1", apiChargeId: "c1" }));
    expect(online).toMatchObject({ type: "sale", channel: "online" });
  });

  it("keeps shillings as shillings and refuses unknown currencies", () => {
    expect(ev("t", sale({ currency: "SLS", amount: 50000, feeCents: 500, netCents: 49500 }))).toMatchObject({
      currency: "SLS",
      gross: 50000,
      net: 49500,
    });
    expect(statsCurrency(undefined)).toBe("USD");
    expect(classifyTransaction("t", sale({ currency: "EUR" }) as any)).toBeNull();
  });

  it("reads refunds against the shop that paid them back", () => {
    const refund = ev("r1", {
      type: "refund",
      kind: "refund",
      fromUserId: SHOP,
      toUserId: AMINA,
      amount: 400,
      feeCents: 4,
      netCents: 396,
      currency: "USD",
      status: "completed",
      journalEntryId: "refund_t1_1",
      createdAt: T(NOV18_0900),
      completedAt: T(NOV18_0900),
    });
    expect(refund).toMatchObject({ type: "refund", storeUid: SHOP, customerUid: AMINA, gross: 400, fee: 4, net: 396 });
  });

  it("reads agent cash-in and cash-out as work for the agent", () => {
    const cashIn = ev("c1", {
      type: "topup",
      kind: "cash_in",
      fromUserId: "agent-1",
      toUserId: AMINA,
      amount: 2000,
      commissionCents: 40,
      currency: "USD",
      status: "completed",
      createdAt: T(NOV18_0900),
    });
    expect(cashIn).toMatchObject({ type: "cash_in", storeUid: "agent-1", amount: 2000, commission: 40 });
    const cashOut = ev("c2", {
      type: "withdrawal",
      kind: "cash_out",
      fromUserId: AMINA,
      toUserId: "agent-1",
      amount: 1500,
      commissionCents: 15,
      currency: "USD",
      status: "completed",
      createdAt: T(NOV18_0900),
      completedAt: T(NOV18_0900 + HOUR),
    });
    expect(cashOut).toMatchObject({ type: "cash_out", storeUid: "agent-1", atMs: NOV18_0900 + HOUR });
  });

  it("ignores rows that aren't shop activity", () => {
    expect(classifyTransaction("t", sale({ status: "pending" }) as any)).toBeNull();
    expect(classifyTransaction("t", sale({ fromUserId: SHOP }) as any)).toBeNull();
    expect(classifyTransaction("t", sale({ kind: "p2p", journalEntryId: "p2p_t" }) as any)).toBeNull();
    expect(classifyTransaction("t", sale({ kind: "payroll", journalEntryId: "payroll_t" }) as any)).toBeNull();
    expect(classifyTransaction("t", sale({ amount: 0 }) as any)).toBeNull();
    // A pending cash-out has no agent yet.
    expect(
      classifyTransaction("t", { type: "withdrawal", kind: "cash_out", fromUserId: AMINA, toUserId: "", amount: 5, status: "completed", createdAt: T(1) } as any)
    ).toBeNull();
  });

  it("derives the kind of rows written before kinds existed", () => {
    const old = sale();
    delete (old as any).kind;
    old.journalEntryId = "paymerchant_old";
    expect(ev("t", old)).toMatchObject({ type: "sale", channel: "sticker" });
  });
});

describe("becameCompleted", () => {
  it("fires once, on the change to completed", () => {
    expect(becameCompleted(undefined, { status: "completed" })).toBe(true);
    expect(becameCompleted({ status: "pending" }, { status: "completed" })).toBe(true);
    expect(becameCompleted({ status: "completed" }, { status: "completed" })).toBe(false);
    expect(becameCompleted(undefined, { status: "pending" })).toBe(false);
    expect(becameCompleted({ status: "completed" }, undefined)).toBe(false);
  });
});

describe("shortName and customer folding", () => {
  it("shortens names for the live feed", () => {
    expect(shortName("Amina Hassan Ali")).toBe("Amina H.");
    expect(shortName("Bashir")).toBe("Bashir");
    expect(shortName("  ")).toBeUndefined();
    expect(shortName(undefined)).toBeUndefined();
  });

  it("learns a customer's usual gap between visits", () => {
    const first = foldCustomer(undefined, ev("a", sale()) as any, true, 0);
    expect(first).toMatchObject({ visits: 1, visitDays: 1, usualGapDays: null, spendUSD: 1000 });
    const second = foldCustomer(first, ev("b", sale({ completedAt: T(NOV18_0900 + 7 * DAY) })) as any, true, 0);
    expect(second).toMatchObject({ visits: 2, visitDays: 2, usualGapDays: 7, lastSeenDay: "2026-11-25" });
    const third = foldCustomer(second, ev("c", sale({ completedAt: T(NOV18_0900 + 10 * DAY) })) as any, true, 0);
    expect(third.usualGapDays).toBeCloseTo(5.8, 1); // 7 * 0.7 + 3 * 0.3
    // A late event from an earlier day doesn't disturb the gap or last seen.
    const late = foldCustomer(third, ev("d", sale({ completedAt: T(NOV18_0900 - 2 * DAY) })) as any, true, 0);
    expect(late).toMatchObject({ usualGapDays: third.usualGapDays, lastSeenDay: "2026-11-28", firstSeenDay: "2026-11-16" });
  });
});

describe("applyStoreEvent", () => {
  let db: FakeDb;
  const apply = (e: StoreEvent) => applyStoreEvent(e, { db: db as any, nowMs: 1 });
  const day = (d = "2026-11-18") => db.get(`merchantStats/${SHOP}/days/${d}`) as PeriodStats;

  beforeEach(() => {
    db = fakeFirestore({ [`users/${AMINA}`]: { fullName: "Amina Hassan" } });
  });

  it("counts a sale in the day, month, customer, feed and shop docs", async () => {
    await expect(apply(ev("t1", sale()))).resolves.toBe("applied");
    const d = day();
    expect(d.currencies.USD!.sales).toEqual({ count: 1, gross: 1000, fee: 10, net: 990 });
    expect(d.currencies.USD!.hours.count[9]).toBe(1);
    expect(d.currencies.USD!.channels.sale_qr).toEqual({ count: 1, net: 990 });
    expect(d.customers).toEqual({ unique: 1, new: 1, returning: 0 });
    expect(db.get(`merchantStats/${SHOP}/months/2026-11`)!.currencies.USD.sales.count).toBe(1);
    expect(db.get(`merchantStats/${SHOP}/customers/${AMINA}`)).toMatchObject({ visits: 1, spendUSD: 1000, firstSeenDay: "2026-11-18" });
    expect(db.get(`merchantStats/${SHOP}/live/recent`)!.items[0]).toMatchObject({
      txId: "t1",
      type: "sale",
      customerName: "Amina H.",
      channel: "sale_qr",
    });
    expect(db.get(`merchantStats/${SHOP}`)).toMatchObject({ lastActivityDay: "2026-11-18", lastSaleAtMs: NOV18_0900 });
  });

  it("counts a row once however often it arrives", async () => {
    await apply(ev("t1", sale()));
    await expect(apply(ev("t1", sale()))).resolves.toBe("already_applied");
    expect(day().currencies.USD!.sales.count).toBe(1);
    expect(db.get(`merchantStats/${SHOP}/customers/${AMINA}`)!.visits).toBe(1);
  });

  it("counts unique and returning customers exactly", async () => {
    // Amina was here last week.
    await apply(ev("t0", sale({ completedAt: T(NOV18_0900 - 7 * DAY) })));
    await apply(ev("t1", sale()));
    await apply(ev("t2", sale({ completedAt: T(NOV18_0900 + HOUR) })));
    await apply(ev("t3", sale({ fromUserId: BASHIR, completedAt: T(NOV18_0900 + 2 * HOUR) })));
    expect(day().customers).toEqual({ unique: 2, new: 1, returning: 1 });
    expect(day().currencies.USD!.sales.count).toBe(3);
    expect(db.get(`merchantStats/${SHOP}/months/2026-11`)!.customers).toEqual({ unique: 2, new: 2, returning: 0 });
    expect(db.get(`merchantStats/${SHOP}/customers/${AMINA}`)).toMatchObject({ visits: 3, visitDays: 2, usualGapDays: 7 });
  });

  it("keeps dollars and shillings apart", async () => {
    await apply(ev("t1", sale()));
    await apply(ev("t2", sale({ currency: "SLS", amount: 60000, feeCents: 600, netCents: 59400 })));
    expect(day().currencies.USD!.sales.gross).toBe(1000);
    expect(day().currencies.SLS!.sales.gross).toBe(60000);
    // One customer, whatever they paid in.
    expect(day().customers.unique).toBe(1);
    expect(db.get(`merchantStats/${SHOP}/customers/${AMINA}`)).toMatchObject({ spend: { USD: 1000, SLS: 60000 }, spendSLS: 60000 });
  });

  it("subtracts nothing on refund but records it, and skips unknown customers", async () => {
    await apply(ev("t1", sale()));
    const refundRow = {
      type: "refund",
      kind: "refund",
      fromUserId: SHOP,
      toUserId: AMINA,
      amount: 1000,
      feeCents: 10,
      netCents: 990,
      currency: "USD",
      status: "completed",
      journalEntryId: "refund_t1",
      createdAt: T(NOV18_0900 + HOUR),
      completedAt: T(NOV18_0900 + HOUR),
    };
    await apply(ev("r1", refundRow));
    expect(day().currencies.USD!.refunds).toEqual({ count: 1, gross: 1000, fee: 10, net: 990 });
    expect(day().currencies.USD!.sales.count).toBe(1);
    expect(db.get(`merchantStats/${SHOP}/customers/${AMINA}`)).toMatchObject({ refunded: { USD: 1000 }, visits: 1 });
    expect(db.get(`merchantStats/${SHOP}/live/recent`)!.items.map((i: any) => i.type)).toEqual(["refund", "sale"]);

    // A refund of a sale from before the read model: no phantom customer.
    await apply(ev("r2", { ...refundRow, toUserId: BASHIR }));
    expect(db.get(`merchantStats/${SHOP}/customers/${BASHIR}`)).toBeUndefined();
  });

  it("tells the counter tablet's scans from the phone's", async () => {
    db.store.set("paymentRequests/reqD", { source: "counter_display" });
    db.store.set("paymentRequests/reqP", {});
    await apply(ev("t1", sale({ journalEntryId: "custqr_reqD" })));
    await apply(ev("t2", sale({ journalEntryId: "custqr_reqP" })));
    expect(day().currencies.USD!.channels.display_scan.count).toBe(1);
    expect(day().currencies.USD!.channels.scan.count).toBe(1);
  });

  it("stays exact when an earlier day's sale arrives late", async () => {
    await apply(ev("t2", sale()));
    await apply(ev("t1", sale({ completedAt: T(NOV18_0900 - DAY) })));
    expect(day("2026-11-17").customers.unique).toBe(1);
    expect(day("2026-11-18").customers.unique).toBe(1);
    expect(db.get(`merchantStats/${SHOP}/customers/${AMINA}`)).toMatchObject({ visitDays: 2, firstSeenDay: "2026-11-17", lastSeenDay: "2026-11-18" });
    expect(db.get(`merchantStats/${SHOP}`)!.lastActivityDay).toBe("2026-11-18");
  });

  it("counts agent work and commission", async () => {
    await apply(
      ev("c1", { type: "topup", kind: "cash_in", fromUserId: SHOP, toUserId: AMINA, amount: 2000, commissionCents: 40, currency: "USD", status: "completed", createdAt: T(NOV18_0900) })
    );
    expect(day().currencies.USD!.agent).toEqual({ cashIn: { count: 1, amount: 2000 }, cashOut: { count: 0, amount: 0 }, commission: 40 });
    expect(day().customers.unique).toBe(0);
    expect(db.get(`merchantStats/${SHOP}/live/recent`)).toBeUndefined();
  });
});

describe("nightly catch-up, check and backfill", () => {
  let db: FakeDb;
  const NOW = NOV18_0900 + DAY; // 2026-11-19 09:00 local: "yesterday" is the 18th

  beforeEach(() => {
    db = fakeFirestore({
      "transactions/t1": sale(),
      "transactions/t2": sale({ fromUserId: BASHIR, completedAt: T(NOV18_0900 + HOUR) }),
      "transactions/t3": sale({ kind: "p2p", journalEntryId: "p2p_t3" }),
      "transactions/t4": sale({ completedAt: T(NOV18_0900 - 2 * DAY), createdAt: T(NOV18_0900 - 2 * DAY) }),
    });
  });

  it("applies what the trigger missed, once", async () => {
    // The trigger caught t1 but not t2.
    await applyStoreEvent(ev("t1", sale()), { db: db as any });
    const { startMs, endMs } = dayBounds("2026-11-18");
    const { scanned, events } = await eventsCompletedBetween(db as any, startMs, endMs);
    expect(scanned).toBe(3);
    expect(events.map((e) => e.txId).sort()).toEqual(["t1", "t2"]);
    await expect(catchUp(db as any, events)).resolves.toBe(1);
    await expect(catchUp(db as any, events)).resolves.toBe(0);
    expect(db.get(`merchantStats/${SHOP}/days/2026-11-18`)!.customers.unique).toBe(2);
  });

  it("finds zero drift after a clean day, and reports a tampered one", async () => {
    const { startMs, endMs } = dayBounds("2026-11-18");
    const { events } = await eventsCompletedBetween(db as any, startMs, endMs);
    await catchUp(db as any, events);
    await expect(checkDay(db as any, "2026-11-18", events)).resolves.toEqual({ storesChecked: 1, drifts: [] });

    const path = `merchantStats/${SHOP}/days/2026-11-18`;
    const doc = db.get(path)!;
    doc.currencies.USD.sales.net += 5;
    db.store.set(path, doc);
    const { drifts } = await checkDay(db as any, "2026-11-18", events);
    expect(drifts).toEqual([`${SHOP} 2026-11-18 currencies.USD.sales.net: stored 1985, rows 1980`]);
  });

  it("diffs missing docs as zeros", () => {
    const rebuilt = { storeUid: SHOP, period: "d", currencies: {}, customers: { unique: 1, new: 0, returning: 1 }, updatedAtMs: 0 };
    expect(diffDay(undefined, rebuilt)).toEqual(["customers.unique: stored 0, rows 1"]);
  });

  it("backfills history in slices through the same path, and finishes", async () => {
    // The trigger has already counted t1 live.
    await applyStoreEvent(ev("t1", sale()), { db: db as any });
    db.store.set("config/merchantStats", { backfill: { active: true } });
    const state = await backfillStep(db as any);
    expect(state).toMatchObject({ active: false, scanned: 4, applied: 2 });
    expect(db.get(`merchantStats/${SHOP}/days/2026-11-18`)!.currencies.USD.sales.count).toBe(2);
    expect(db.get(`merchantStats/${SHOP}/days/2026-11-16`)!.currencies.USD.sales.count).toBe(1);
    expect(db.get(`merchantStats/${SHOP}/customers/${AMINA}`)).toMatchObject({ visits: 2, firstSeenDay: "2026-11-16" });
    // Off again: a second run does nothing.
    await expect(backfillStep(db as any)).resolves.toBeNull();
  });

  it("pauses when out of time and resumes from the cursor", async () => {
    db.store.set("config/merchantStats", { backfill: { active: true } });
    let t = 0;
    const clock = () => t++;
    // A zero budget: nothing runs, the state stays active.
    const paused = await backfillStep(db as any, 0, clock);
    expect(paused).toMatchObject({ active: true, scanned: 0 });
    const done = await backfillStep(db as any, 1000, () => 0);
    expect(done).toMatchObject({ active: false, scanned: 4, applied: 3 });
  });

  it("records each night's run", async () => {
    const result = await runMerchantStatsNightly(NOW, db as any);
    expect(result).toMatchObject({ day: "2026-11-18", caughtUp: 2, storesChecked: 1, drifts: [] });
    expect(db.get("merchantStatsRuns/2026-11-18")).toMatchObject({ caughtUp: 2, driftCount: 0, shopEvents: 2 });
  });
});

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import { mergeState, makeFlash, syncCounterState, firstName } from "../counterDisplay/state";
import { flashForQr, flashForRequest, flashForTransaction } from "../counterDisplay/triggers";
import { normaliseScannedToken } from "../counterDisplay/tokenFormat";
import { CounterDisplayState } from "../counterDisplay/types";

const { Timestamp } = admin.firestore;
const SHOP = "merchant-1";
const STATE_KEY = "a".repeat(64);
const SALE_ID = "1".repeat(32);

type Derived = Omit<CounterDisplayState, "flash">;

const derived = (over: Partial<Derived> = {}): Derived => ({
  v: 1,
  merchantName: "Hodan's Shop",
  idleQr: "{}",
  mode: "idle",
  lang: "en",
  derivedAtMs: 1000,
  ...over,
});

/**
 * What a counter display shows is re-derived from the shop's live QR and
 * request on every change. These pin the rules for merging that with what is
 * already stored: order, flashes, and what never goes on a public screen.
 */
describe("counter display state: merge rules", () => {
  const sale = { id: SALE_ID, qrData: "000201", amountCents: 1250, currency: "USD" as const, createdAtMs: 5000, expiresAtMs: 600_000 };

  it("an older derivation never overwrites a newer one", () => {
    const stored = { ...derived({ mode: "sale", sale, derivedAtMs: 2000 }) } as CounterDisplayState;
    const out = mergeState(stored, derived({ derivedAtMs: 1500 }), undefined, 3000);
    expect(out.mode).toBe("sale");
    expect(out.sale).toEqual(sale);
  });

  it("a newer derivation replaces the screen", () => {
    const stored = derived({ mode: "sale", sale, derivedAtMs: 1000 }) as CounterDisplayState;
    const out = mergeState(stored, derived({ derivedAtMs: 2000 }), undefined, 3000);
    expect(out.mode).toBe("idle");
    expect(out.sale).toBeUndefined();
  });

  it("keeps Paid through an unrelated re-sync, until it runs out", () => {
    const flash = makeFlash("paid", 1250, 10_000, "ZP-7K3M-9QX2");
    const stored = { ...derived(), flash } as CounterDisplayState;
    expect(mergeState(stored, derived({ derivedAtMs: 11_000 }), undefined, 11_000).flash).toEqual(flash);
    expect(mergeState(stored, derived({ derivedAtMs: 19_000 }), undefined, 18_001).flash).toBeUndefined();
  });

  it("a new sale clears Paid at once", () => {
    const stored = { ...derived(), flash: makeFlash("paid", 1250, 10_000) } as CounterDisplayState;
    const out = mergeState(
      stored,
      derived({ mode: "sale", sale: { ...sale, createdAtMs: 12_000 }, derivedAtMs: 12_500 }),
      undefined,
      12_500
    );
    expect(out.flash).toBeUndefined();
    expect(out.mode).toBe("sale");
  });

  it("a redelivered event can't stretch a flash: it is timed from when it happened", () => {
    const a = makeFlash("paid", 1250, 10_000);
    const again = makeFlash("paid", 1250, 10_000);
    const stored = { ...derived(), flash: a } as CounterDisplayState;
    expect(mergeState(stored, derived({ derivedAtMs: 15_000 }), again, 15_000).flash!.showUntilMs).toBe(18_000);
  });

  it("an older flash doesn't replace a newer one", () => {
    const newer = makeFlash("paid", 900, 20_000);
    const stored = { ...derived(), flash: newer } as CounterDisplayState;
    expect(mergeState(stored, derived({ derivedAtMs: 21_000 }), makeFlash("declined", 500, 19_000), 21_000).flash).toEqual(newer);
  });

  it("takes a first name only", () => {
    expect(firstName("  Amina Yusuf Ali ")).toBe("Amina");
    expect(firstName(undefined)).toBe("");
  });
});

describe("counter display state: what the triggers flash", () => {
  const ts = (ms: number) => Timestamp.fromMillis(ms);

  it("Paid when a sale's QR is paid", () => {
    const f = flashForQr(
      { status: "active", amount: 1250 } as any,
      { status: "used", amount: 1250, paidAmount: 1250, receiptNumber: "ZP-1111-2222", usedAt: ts(50_000) } as any
    );
    expect(f).toEqual({ kind: "paid", amountCents: 1250, receiptNumber: "ZP-1111-2222", atMs: 50_000, showUntilMs: 58_000 });
    // A QR the cashier cancelled, or a tablet scan replaced, shows no flash.
    expect(flashForQr({ status: "active" } as any, { status: "expired" } as any)).toBeUndefined();
  });

  it("Paid, Declined or Expired when a request resolves; nothing for a cash-out or a cancel", () => {
    const pending = { status: "pending", amount: 900 } as any;
    expect(flashForRequest(pending, { status: "approved", amount: 900, receiptNumber: "ZP-A", resolvedAt: ts(1000) } as any)).toMatchObject({
      kind: "paid",
      receiptNumber: "ZP-A",
    });
    expect(flashForRequest(pending, { status: "rejected", amount: 900, resolvedAt: ts(1000) } as any)!.kind).toBe("declined");
    expect(flashForRequest(pending, { status: "expired", amount: 900, resolvedAt: ts(1000) } as any)!.kind).toBe("expired");
    expect(flashForRequest(pending, { status: "cancelled", amount: 900 } as any)).toBeUndefined();
    expect(flashForRequest(pending, { status: "approved", amount: 900, purpose: "cash_out" } as any)).toBeUndefined();
    expect(flashForRequest(undefined, { status: "pending", amount: 900 } as any)).toBeUndefined();
  });

  it("Paid for a My QR payment, and for nothing else in transactions", () => {
    const row = {
      type: "payment",
      kind: "merchant_payment",
      status: "completed",
      toUserId: SHOP,
      amount: 700,
      receiptNumber: "ZP-B",
      journalEntryId: "paymerchant_abc",
      createdAt: ts(9000),
    } as any;
    expect(flashForTransaction(row)).toEqual({ merchantId: SHOP, flash: makeFlash("paid", 700, 9000, "ZP-B") });
    // Dynamic-QR and request payments are flashed by their own triggers.
    expect(flashForTransaction({ ...row, journalEntryId: "qrpay_x" })).toBeUndefined();
    expect(flashForTransaction({ ...row, journalEntryId: "custqr_x" })).toBeUndefined();
    expect(flashForTransaction({ ...row, kind: "p2p", type: "transfer" })).toBeUndefined();
  });
});

describe("counter display state: derived from the shop's live sale", () => {
  let restore: (() => void) | undefined;
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali" },
      [`merchantProfiles/${SHOP}`]: { businessName: "Hodan's Shop" },
      [`merchantDisplays/cd_${"0".repeat(24)}`]: { merchantId: SHOP, status: "active", stateKey: STATE_KEY },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const now = () => Date.now();
  const qr = (over: Record<string, any> = {}) => ({
    merchantId: SHOP,
    amount: 1250,
    currency: "USD",
    status: "active",
    emvQrData: "00020101021226…",
    reference: "INV-7",
    createdAt: Timestamp.fromMillis(now() - 1000),
    expiresAt: Timestamp.fromMillis(now() + 600_000),
    feeCents: 25,
    netCents: 1225,
    ...over,
  });
  const req = (over: Record<string, any> = {}) => ({
    merchantId: SHOP,
    customerId: "cust-1",
    tokenId: "t1",
    amount: 900,
    currency: "USD",
    status: "pending",
    customerName: "Amina Yusuf",
    createdAt: Timestamp.fromMillis(now()),
    expiresAt: Timestamp.fromMillis(now() + 120_000),
    ...over,
  });
  const state = (db: FakeDb) => db.get(`counterDisplayStates/${STATE_KEY}`) as CounterDisplayState;

  it("idle with the shop's My QR when nothing is open", async () => {
    const db = seed();
    await syncCounterState(SHOP);
    expect(state(db)).toMatchObject({ mode: "idle", merchantName: "Hodan's Shop" });
    expect(JSON.parse(state(db).idleQr)).toMatchObject({ type: "quickpay_merchant", merchantId: SHOP });
  });

  it("shows the open sale, and nothing a customer shouldn't see", async () => {
    const db = seed({ [`qrCodes/${SALE_ID}`]: qr() });
    await syncCounterState(SHOP);
    const s = state(db);
    expect(s.mode).toBe("sale");
    expect(s.sale).toMatchObject({ id: SALE_ID, amountCents: 1250, reference: "INV-7", qrData: "00020101021226…" });
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/feeCents|netCents|balance|cust-1|Yusuf/);
  });

  it("drops an expired sale", async () => {
    const db = seed({ [`qrCodes/${SALE_ID}`]: qr({ expiresAt: Timestamp.fromMillis(now() - 1) }) });
    await syncCounterState(SHOP);
    expect(state(db).mode).toBe("idle");
  });

  it("shows a pending request with the payer's first name only", async () => {
    const db = seed({ ["paymentRequests/t1"]: req() });
    await syncCounterState(SHOP);
    expect(state(db)).toMatchObject({ mode: "approving", request: { id: "t1", amountCents: 900, customerFirstName: "Amina" } });
    expect(JSON.stringify(state(db))).not.toMatch(/Yusuf|cust-1/);
  });

  it("ignores an agent's cash-out request", async () => {
    const db = seed({ ["paymentRequests/t1"]: req({ purpose: "cash_out" }) });
    await syncCounterState(SHOP);
    expect(state(db).mode).toBe("idle");
  });

  it("newest wins when a sale and a request are both open", async () => {
    const db = seed({
      [`qrCodes/${SALE_ID}`]: qr({ createdAt: Timestamp.fromMillis(now() + 5000) }),
      ["paymentRequests/t1"]: req(),
    });
    await syncCounterState(SHOP);
    expect(state(db).mode).toBe("sale");
  });

  it("says the shop can't take payments while it is frozen", async () => {
    const db = seed({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan Ali", accountStatus: "frozen" },
      [`qrCodes/${SALE_ID}`]: qr(),
    });
    await syncCounterState(SHOP);
    expect(state(db).mode).toBe("unavailable");
    expect(state(db).sale).toBeUndefined();
  });

  it("writes nothing for a shop with no display", async () => {
    const db = fakeFirestore({ [`users/${SHOP}`]: { accountType: "merchant" }, [`qrCodes/${SALE_ID}`]: qr() });
    restore = useFakeFirestore(db);
    await syncCounterState(SHOP);
    expect([...db.store.keys()].filter((k) => k.startsWith("counterDisplayStates/"))).toHaveLength(0);
  });

  it("skips the write when nothing changed", async () => {
    const db = seed({ [`qrCodes/${SALE_ID}`]: qr() });
    await syncCounterState(SHOP);
    const first = (state(db) as any).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await syncCounterState(SHOP);
    expect((state(db) as any).updatedAt).toBe(first);
  });

  it("writes to every display of the shop, and to no other shop's", async () => {
    const OTHER_KEY = "b".repeat(64);
    const THIRD_KEY = "c".repeat(64);
    const db = seed({
      [`merchantDisplays/cd_${"1".repeat(24)}`]: { merchantId: SHOP, status: "active", stateKey: OTHER_KEY },
      [`merchantDisplays/cd_${"2".repeat(24)}`]: { merchantId: "someone-else", status: "active", stateKey: THIRD_KEY },
      [`merchantDisplays/cd_${"3".repeat(24)}`]: { merchantId: SHOP, status: "revoked", stateKey: null },
      [`qrCodes/${SALE_ID}`]: qr(),
    });
    await syncCounterState(SHOP);
    expect(db.get(`counterDisplayStates/${STATE_KEY}`)!.mode).toBe("sale");
    expect(db.get(`counterDisplayStates/${OTHER_KEY}`)!.mode).toBe("sale");
    expect(db.get(`counterDisplayStates/${THIRD_KEY}`)).toBeUndefined();
  });
});

describe("reading a scanned customer code", () => {
  const cases: Array<{ name: string; raw: string; expected: string | null }> = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../counterDisplay/__fixtures__/scannedTokens.json"), "utf8")
  );
  it.each(cases)("$name", ({ raw, expected }) => {
    expect(normaliseScannedToken(raw)).toBe(expected);
  });
  it("refuses anything that isn't text", () => {
    expect(normaliseScannedToken(undefined)).toBeNull();
    expect(normaliseScannedToken(42)).toBeNull();
    expect(normaliseScannedToken("v2:" + "a".repeat(5000))).toBeNull();
  });
});

import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";
import {
  prepareJournalEntry,
  userAccount,
  agentAccount,
  InsufficientBalanceError,
  FrozenAccountError,
  PLATFORM_FEES,
  JournalLine,
} from "../ledger";
import { analyzeActivity } from "../ledger/activityMonitor";
import { floatDeltaOf } from "../admin/floatMigration";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

import { verifyUserPin } from "../auth/validatePin";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const AGENT = "agent-1";
const KEY = "4b2a6c1e-9b4d-4a77-8e21-0c5d7a9f1b33";
const float = (cents: number) => ({ account: `agent:${AGENT}`, balance: cents, currency: "USD" });

/** AGENT_FLOAT_SEPARATION.md: float in agent:{uid}, apart from the wallet. */
describe("agent float account", () => {
  let restore: (() => void) | undefined;
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  beforeEach(() => mockedPin.mockReset().mockResolvedValue(true));
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const use = (seed: Record<string, any>): FakeDb => {
    const db = fakeFirestore(seed);
    restore = useFakeFirestore(db);
    return db;
  };

  const spendFloat = (db: FakeDb, cents: number) =>
    db.runTransaction(async (tx: any) => {
      const p = await prepareJournalEntry(tx, {
        entryId: `t_${Math.random().toString(36).slice(2)}`,
        type: "agent_topup",
        currency: "USD",
        lines: [
          { account: agentAccount(AGENT), debit: cents, credit: 0 },
          { account: userAccount("cust-1"), debit: 0, credit: cents },
        ],
        description: "test",
        postedBy: AGENT,
      });
      p.write(tx);
    });

  describe("in the ledger", () => {
    it("can't go negative, and stays an exact balance", async () => {
      const db = use({
        [`wallets/${AGENT}`]: wallet(50_000),
        "wallets/cust-1": wallet(0),
        [`ledger_balances/agent:${AGENT}`]: float(1_000),
      });
      await spendFloat(db, 600);
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(400);
      // A large wallet doesn't fund float.
      await expect(spendFloat(db, 401)).rejects.toBeInstanceOf(InsufficientBalanceError);
      expect(db.get(`wallets/${AGENT}`)!.balance).toBe(50_000);
    });

    it("can't be spent by a frozen agent", async () => {
      const db = use({
        [`wallets/${AGENT}`]: wallet(0, { frozen: true }),
        "wallets/cust-1": wallet(0),
        [`ledger_balances/agent:${AGENT}`]: float(1_000),
      });
      await expect(spendFloat(db, 100)).rejects.toBeInstanceOf(FrozenAccountError);
    });
  });

  describe("moveToFloat", () => {
    let move: any;
    beforeAll(async () => {
      move = test.wrap((await import("../agents/moveToFloat")).moveToFloat);
    });
    const seed = (extra: Record<string, any> = {}) =>
      use({
        [`users/${AGENT}`]: { accountType: "agent_merchant", fullName: "Corner Shop" },
        [`wallets/${AGENT}`]: wallet(5_000),
        ...extra,
      });
    const call = (amountCents: number, uid = AGENT, key = KEY) =>
      move({ data: { amountCents, pin: "123456", idempotencyKey: key }, auth: { uid } });

    it("moves sales into float, once per key", async () => {
      const db = seed();
      const res = await call(2_000);
      expect(res.data).toEqual({ floatCents: 2_000, walletCents: 3_000 });
      expect((await call(2_000)).data).toEqual({ floatCents: 2_000, walletCents: 3_000 });
      expect(db.get(`wallets/${AGENT}`)!.balance).toBe(3_000);
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(2_000);
      expect(db.get(`transactions/floatmove_${AGENT}_${KEY}`)).toMatchObject({ kind: "float", amount: 2_000 });
    });

    it("can't move money owed on a lost dispute, or more than the wallet holds", async () => {
      seed({ [`wallets/${AGENT}`]: wallet(5_000, { reservedCents: 4_000 }) });
      const err = await call(1_500).catch((e: any) => e);
      expect(err.details).toEqual({ reason: "insufficient_balance" });
      await expect(call(6_000, AGENT, "5b2a6c1e-9b4d-4a77-8e21-0c5d7a9f1b33")).rejects.toThrow(/that much/);
    });

    it("is for agents only, with the PIN", async () => {
      seed({ "users/shop-1": { accountType: "merchant" }, "wallets/shop-1": wallet(5_000) });
      await expect(call(100, "shop-1")).rejects.toThrow(/Only agents/);
      mockedPin.mockResolvedValue(false);
      await expect(call(100)).rejects.toThrow(/Invalid PIN/);
    });
  });

  describe("migration", () => {
    let migrate: any;
    beforeAll(async () => {
      migrate = test.wrap((await import("../admin/floatMigration")).adminMigrateAgentFloat);
    });
    const adminAuth = (roles = ["super"]) => ({
      uid: "admin-1",
      token: { admin: true, adminRoles: roles, email: "a@zapp.example", auth_time: Math.floor(Date.now() / 1000) },
    });
    const entry = (type: string, lines: JournalLine[]) => ({ type, currency: "USD", lines, refs: {}, postedBy: "x" });
    const A = userAccount(AGENT);

    /** $200 issued, $50 cashed in (+$1 commission), $30 cashed out (+$0.60), $10 of shop sales. */
    const seed = (walletCents = 20_000 - 5_000 + 100 + 3_000 + 60 + 1_000) =>
      use({
        [`users/${AGENT}`]: { accountType: "agent_merchant", fullName: "Corner Shop" },
        [`wallets/${AGENT}`]: wallet(walletCents),
        "journal_entries/float_issue_f1": entry("float_issue", [
          { account: "float:agents", debit: 20_000, credit: 0 },
          { account: A, debit: 0, credit: 20_000 },
        ]),
        "journal_entries/agenttopup_r1": entry("agent_topup", [
          { account: A, debit: 5_000, credit: 0 },
          { account: "user:cust-1", debit: 0, credit: 5_000 },
          { account: PLATFORM_FEES, debit: 100, credit: 0 },
          { account: A, debit: 0, credit: 100 },
        ]),
        "journal_entries/cashout_c1": entry("agent_cashout", [
          { account: "platform:cashout_hold", debit: 3_000, credit: 0 },
          { account: A, debit: 0, credit: 3_000 },
          { account: PLATFORM_FEES, debit: 60, credit: 0 },
          { account: A, debit: 0, credit: 60 },
        ]),
        "journal_entries/qrpay_q1": entry("qr_payment", [
          { account: "user:cust-2", debit: 1_000, credit: 0 },
          { account: A, debit: 0, credit: 1_000 },
        ]),
      });

    it("reads each entry's float part without the commission", () => {
      expect(
        floatDeltaOf("agent_topup", [
          { account: A, debit: 5_000, credit: 0 },
          { account: PLATFORM_FEES, debit: 100, credit: 0 },
          { account: A, debit: 0, credit: 100 },
        ], AGENT)
      ).toBe(-5_000);
    });

    it("previews float = issued − cashed in + cashed out, and posts nothing", async () => {
      const db = seed();
      const res = await migrate({ data: { reason: "Preview the float split" }, auth: adminAuth(["ops"]) });
      expect(res.data.rows[0]).toMatchObject({ agentId: AGENT, computedCents: 18_000, moveCents: 18_000, alreadyMigrated: false });
      expect(db.get(`ledger_balances/agent:${AGENT}`)).toBeUndefined();
    });

    it("applies once: float moves out of the wallet, sales and commission stay", async () => {
      const db = seed();
      await migrate({ data: { apply: true, reason: "Split float on deploy day" }, auth: adminAuth() });
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(18_000);
      expect(db.get(`wallets/${AGENT}`)!.balance).toBe(1_000 + 100 + 60);
      const again = await migrate({ data: { apply: true, reason: "Run it again" }, auth: adminAuth() });
      expect(again.data.rows[0]).toMatchObject({ alreadyMigrated: true, moveCents: 18_000 });
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(18_000);
    });

    it("never moves more than the wallet holds, and reports the shortfall", async () => {
      seed(12_000);
      const res = await migrate({ data: { reason: "Preview a short agent" }, auth: adminAuth() });
      expect(res.data.rows[0]).toMatchObject({ computedCents: 18_000, moveCents: 12_000, shortfallCents: 6_000 });
    });

    it("takes ops' override, and needs a super admin to apply", async () => {
      const db = seed();
      await expect(migrate({ data: { apply: true, reason: "Ops can't apply" }, auth: adminAuth(["ops"]) })).rejects.toThrow(/not authorized/i);
      await migrate({ data: { apply: true, reason: "Checked with the agent", overrides: { [AGENT]: 15_000 } }, auth: adminAuth() });
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(15_000);
    });
  });

  describe("activity monitor", () => {
    const at = admin.firestore.Timestamp.now();
    const e = (id: string, type: string, lines: JournalLine[], customer?: string) => ({ id, type, lines, postedAt: at, ...(customer ? { customer } : {}) });

    it("still flags an agent cashing themselves in from their own float", () => {
      const findings = analyzeActivity([
        e("t1", "agent_topup", [
          { account: agentAccount(AGENT), debit: 5_000, credit: 0 },
          { account: userAccount(AGENT), debit: 0, credit: 5_000 },
          { account: PLATFORM_FEES, debit: 100, credit: 0 },
          { account: userAccount(AGENT), debit: 0, credit: 100 },
        ]),
      ] as any);
      expect(findings.map((f) => f.kind)).toContain("self_dealing");
    });

    it("doesn't flag moving one's own sales into float", () => {
      const findings = analyzeActivity([
        e("m1", "float_move", [
          { account: userAccount(AGENT), debit: 2_000, credit: 0 },
          { account: agentAccount(AGENT), debit: 0, credit: 2_000 },
        ]),
      ] as any);
      expect(findings.filter((f) => f.kind === "self_dealing")).toHaveLength(0);
    });
  });
});

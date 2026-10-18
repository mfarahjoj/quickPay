import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const { Timestamp } = admin.firestore;
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) => Timestamp.fromMillis(Date.now() - days * DAY_MS);

const AGENT = "agent-1";
const agentInfo = { area: "Hargeisa Central", openHours: "8-20", services: ["cash_in", "cash_out"], isActive: true };

const upheld = (days: number, against = AGENT) => ({
  against,
  status: "resolved",
  resolution: { outcome: "upheld", amountCents: 100, decidedAt: ago(days) },
});

describe("agent standing (2.6)", () => {
  let review: (uid: string) => Promise<boolean>;
  let listAgents: any;
  let clearFlag: any;
  let resolve: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const s = await import("../agents/standing");
    review = s.reviewAgentStanding as any;
    listAgents = test.wrap(s.listAgents);
    clearFlag = test.wrap(s.adminClearAgentFlag);
    resolve = test.wrap((await import("../disputes/resolve")).adminResolveDispute);
  });

  beforeEach(() => mockedPin.mockReset().mockResolvedValue(true));

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const use = (seed: Record<string, any>): FakeDb => {
    const db = fakeFirestore({
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Agent Ali", phoneNumber: "+252630000009", agentInfo },
      [`wallets/${AGENT}`]: wallet(10_000),
      ...seed,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const adminAuth = {
    uid: "admin-1",
    token: { admin: true, adminRoles: ["ops"], email: "ops@zapp.example", auth_time: Math.floor(Date.now() / 1000) },
  };

  it("flags an agent at 3 upheld disputes in 30 days", async () => {
    const db = use({ "disputes/a": upheld(1), "disputes/b": upheld(5), "disputes/c": upheld(20) });
    expect(await review(AGENT)).toBe(true);
    expect(db.get(`users/${AGENT}`)!.agentFlag).toMatchObject({ upheldCount: 3, windowDays: 30 });
  });

  it("doesn't count old, rejected or other people's disputes", async () => {
    const db = use({
      "disputes/a": upheld(1),
      "disputes/b": upheld(5),
      "disputes/old": upheld(40),
      "disputes/other": upheld(2, "agent-2"),
      "disputes/rej": { against: AGENT, status: "resolved", resolution: { outcome: "rejected", decidedAt: ago(1) } },
    });
    expect(await review(AGENT)).toBe(false);
    expect(db.get(`users/${AGENT}`)!.agentFlag).toBeUndefined();
  });

  it("ignores non-agents", async () => {
    use({
      "users/shop-1": { accountType: "merchant" },
      "disputes/a": upheld(1, "shop-1"),
      "disputes/b": upheld(1, "shop-1"),
      "disputes/c": upheld(1, "shop-1"),
    });
    expect(await review("shop-1")).toBe(false);
  });

  it("flags from adminResolveDispute when the third claim is upheld", async () => {
    const db = use({
      "disputes/a": upheld(1),
      "disputes/b": upheld(2),
      "users/cust-1": { accountType: "customer" },
      "wallets/cust-1": wallet(0),
      "disputes/c": {
        against: AGENT,
        raisedBy: "cust-1",
        participants: ["cust-1", AGENT],
        status: "under_review",
        disputedKind: "cash_out",
        kind: "cash_not_given",
        amountCents: 500,
        transactionAmountCents: 500,
        currency: "USD",
        messages: [],
        createdAt: ago(1),
      },
    });
    await resolve({ data: { disputeId: "c", outcome: "upheld", reason: "Agent admitted it on the phone" }, auth: adminAuth });
    expect(db.get("wallets/cust-1")!.balance).toBe(500);
    expect(db.get(`users/${AGENT}`)!.agentFlag?.upheldCount).toBe(3);
  });

  it("lists only active, listed, unflagged agents, without private fields", async () => {
    use({
      "users/agent-2": { accountType: "agent_merchant", fullName: "Shop Agent", agentInfo: { ...agentInfo, businessName: "Corner Shop" } },
      "users/agent-flagged": { accountType: "topup_agent", fullName: "F", agentInfo, agentFlag: { upheldCount: 3 } },
      "users/agent-frozen": { accountType: "topup_agent", fullName: "Z", agentInfo, accountStatus: "frozen" },
      "users/agent-off": { accountType: "topup_agent", fullName: "O", agentInfo: { ...agentInfo, isActive: false } },
      "users/agent-noprofile": { accountType: "topup_agent", fullName: "N" },
      "users/cust-1": { accountType: "customer", fullName: "C", pinHash: "secret" },
    });
    const res = await listAgents({ data: undefined, auth: { uid: "cust-1" } });
    const ids = res.data.agents.map((a: any) => a.id).sort();
    expect(ids).toEqual(["agent-1", "agent-2"]);
    expect(res.data.agents.find((a: any) => a.id === "agent-2").name).toBe("Corner Shop");
    expect(JSON.stringify(res)).not.toContain("pinHash");
  });

  it("lets ops clear a flag, with an audit entry", async () => {
    const db = use({ [`users/${AGENT}`]: { accountType: "topup_agent", agentInfo, agentFlag: { upheldCount: 3, flaggedAt: ago(1) } } });
    await clearFlag({ data: { userId: AGENT, reason: "Reviewed all three, agent retrained" }, auth: adminAuth });
    expect(db.get(`users/${AGENT}`)!.agentFlag).toBeUndefined();
    const audit = [...db.store.entries()].find(([p]) => p.startsWith("admin_audit/"))![1];
    expect(audit.action).toBe("agent.unflag");
  });
});

describe("freezeMyAccount (2.7)", () => {
  let freeze: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    freeze = test.wrap((await import("../auth/freezeMyAccount")).freezeMyAccount);
  });

  beforeEach(() => mockedPin.mockReset().mockResolvedValue(true));
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  const use = (user: Record<string, any> = {}) => {
    const db = fakeFirestore({ "users/cust-1": { accountType: "customer", ...user }, "wallets/cust-1": wallet(2_000) });
    restore = useFakeFirestore(db);
    return db;
  };

  it("freezes the account and its wallet", async () => {
    const db = use();
    await freeze({ data: { pin: "123456" }, auth: { uid: "cust-1" } });
    expect(db.get("users/cust-1")).toMatchObject({ accountStatus: "frozen", frozenBy: "cust-1", selfFrozen: true });
    expect(db.get("wallets/cust-1")!.frozen).toBe(true);
  });

  it("needs the right PIN", async () => {
    const db = use();
    mockedPin.mockResolvedValue(false);
    await expect(freeze({ data: { pin: "000000" }, auth: { uid: "cust-1" } })).rejects.toThrow(/Invalid PIN/);
    expect(db.get("wallets/cust-1")!.frozen).toBeUndefined();
  });

  it("leaves an ops freeze as it was", async () => {
    const db = use({ accountStatus: "frozen", frozenBy: "admin-1" });
    const res = await freeze({ data: { pin: "123456" }, auth: { uid: "cust-1" } });
    expect(res.message).toMatch(/already/);
    expect(db.get("users/cust-1")!.frozenBy).toBe("admin-1");
  });

  it("refuses a closed account", async () => {
    use({ accountStatus: "closed" });
    await expect(freeze({ data: { pin: "123456" }, auth: { uid: "cust-1" } })).rejects.toThrow(/closed/);
  });
});

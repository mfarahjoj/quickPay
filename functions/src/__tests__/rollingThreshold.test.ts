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
const HOUR_MS = 60 * 60 * 1000;
const ago = (hours: number) => Timestamp.fromMillis(Date.now() - hours * HOUR_MS);

// DEFAULT_RATES.floatApprovalThresholdCents is $500.

/**
 * A threshold checked per request can be walked under by splitting. These
 * check that both the float desk and payouts count the last 24 hours.
 */
describe("maker-checker over a rolling 24 hours", () => {
  let requestFloat: any;
  let requestPayout: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    requestFloat = test.wrap((await import("../admin/floatDesk")).adminRequestFloat);
    requestPayout = test.wrap((await import("../payouts/requestPayout")).requestPayout);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
  });

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

  describe("adminRequestFloat", () => {
    const AGENT = "agent-1";
    const issuance = (amountCents: number, createdAt: any, extra: Record<string, any> = {}) => ({
      agentId: AGENT,
      direction: "issue",
      amountCents,
      route: "cash",
      status: "approved",
      requestedBy: "admin-1",
      createdAt,
      ...extra,
    });

    const seed = () =>
      use({
        [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Agent Ali" },
        "users/agent-2": { accountType: "topup_agent", fullName: "Agent Two" },
        // $450 still standing in the last day…
        "floatIssuances/f1": issuance(15_000, ago(2)),
        "floatIssuances/f2": issuance(15_000, ago(5), { status: "pending" }),
        "floatIssuances/f3": issuance(15_000, ago(20), { requestedBy: "admin-2" }),
        // …and these don't count.
        "floatIssuances/f4": issuance(40_000, ago(3), { status: "rejected" }),
        "floatIssuances/f5": issuance(40_000, ago(30)),
        "floatIssuances/f6": issuance(40_000, ago(1), { direction: "withdraw" }),
      });

    const adminAuth = {
      uid: "admin-1",
      token: {
        admin: true,
        adminRoles: ["ops"],
        email: "ops@zapp.example",
        auth_time: Math.floor(Date.now() / 1000),
      },
    };

    const ask = (amountCents: number, agentId = AGENT) =>
      requestFloat({
        data: { agentId, direction: "issue", amountCents, route: "cash", reason: "Cash float top-up" },
        auth: adminAuth,
      });

    it("needs a second admin once the day's total crosses the threshold", async () => {
      const db = seed();
      const res = await ask(10_000); // $450 + $100 = $550
      expect(res.data.requiresSecondApprover).toBe(true);
      expect(db.get(`floatIssuances/${res.data.issuanceId}`)!.requiresSecondApprover).toBe(true);
    });

    it("doesn't while the day's total stays under it", async () => {
      seed();
      const res = await ask(4_000); // $450 + $40 = $490
      expect(res.data.requiresSecondApprover).toBe(false);
    });

    it("counts each agent on its own", async () => {
      seed();
      const res = await ask(10_000, "agent-2");
      expect(res.data.requiresSecondApprover).toBe(false);
    });
  });

  describe("requestPayout", () => {
    const MERCHANT = "merch-1";
    const payout = (amountCents: number, createdAt: any, status = "requested") => ({
      merchantId: MERCHANT,
      amountCents,
      route: "bank",
      status,
      createdAt,
    });

    const seed = () =>
      use({
        [`users/${MERCHANT}`]: { accountType: "merchant", fullName: "Hooyo Shop" },
        [`wallets/${MERCHANT}`]: wallet(100_000),
        // $400 standing today…
        "payoutRequests/p1": payout(20_000, ago(2)),
        "payoutRequests/p2": payout(20_000, ago(10), "paid"),
        // …these don't count.
        "payoutRequests/p3": payout(30_000, ago(4), "rejected"),
        "payoutRequests/p4": payout(30_000, ago(26), "paid"),
        "payoutRequests/other": { ...payout(30_000, ago(1)), merchantId: "merch-2" },
      });

    const ask = (amountCents: number) =>
      requestPayout({
        data: {
          amountCents,
          route: "bank",
          destinationName: "Hooyo Shop",
          destinationRef: "0123456789",
          pin: "123456",
        },
        auth: { uid: MERCHANT },
      });

    const latest = (db: FakeDb, id: string) => db.get(`payoutRequests/${id}`)!;

    it("needs a senior admin once the day's total crosses the threshold", async () => {
      const db = seed();
      const res = await ask(10_000); // $400 + $100 = $500
      expect(latest(db, res.data.payoutId).requiresSeniorApproval).toBe(true);
    });

    it("doesn't while the day's total stays under it", async () => {
      const db = seed();
      const res = await ask(5_000); // $400 + $50 = $450
      expect(latest(db, res.data.payoutId).requiresSeniorApproval).toBe(false);
    });
  });
});

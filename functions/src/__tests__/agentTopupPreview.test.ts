import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const AGENT = "agent-1";
const AMINA = "cust-amina";
const BASHIR = "cust-bashir";
const { Timestamp } = admin.firestore;

const FLOAT = 100_000; // $1,000

/**
 * The customer picks a top-up's amount; the agent's float pays it. These
 * cover what stands between the two: the agent is shown the amount before
 * their PIN, the confirm is refused for any other amount, and every call
 * names one request so a code can't land on the wrong customer.
 *
 * The ledger, limits and lockout are real; only the PIN check and pushes are
 * stubbed.
 */
describe("agent top-up: shown first, then confirmed", () => {
  let preview: any;
  let confirm: any;
  let openDispute: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../topup/agentConfirmTopup");
    preview = test.wrap(mod.previewAgentTopup);
    confirm = test.wrap(mod.agentConfirmTopup);
    openDispute = test.wrap((await import("../disputes/disputes")).openDispute);
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

  const request = (customerId: string, amount: number, otpCode: string, extra: Record<string, any> = {}) => ({
    customerId,
    amount,
    currency: "USD",
    otpCode,
    status: "pending",
    expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
    createdAt: Timestamp.now(),
    ...extra,
  });

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Hodan's Shop", kycStatus: "verified" },
      [`users/${AMINA}`]: {
        accountType: "customer",
        fullName: "Amina Yusuf",
        kycStatus: "verified",
        phoneNumber: "+252634120987",
      },
      [`users/${BASHIR}`]: {
        accountType: "customer",
        fullName: "Bashir Ali",
        kycStatus: "verified",
        phoneNumber: "+252634555111",
      },
      [`wallets/${AGENT}`]: wallet(0),
      [`ledger_balances/agent:${AGENT}`]: { account: `agent:${AGENT}`, balance: FLOAT, currency: "USD" },
      [`wallets/${AMINA}`]: wallet(0),
      [`wallets/${BASHIR}`]: wallet(0),
      "agentTopupRequests/req-amina": request(AMINA, 5_000, "123456"),
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const journalEntries = (db: FakeDb) =>
    [...db.store.keys()].filter((p) => p.startsWith("journal_entries/"));

  const asAgent = (data: Record<string, unknown>, uid = AGENT) => ({ data, auth: { uid } });

  describe("previewAgentTopup", () => {
    it("shows the agent who and how much, and moves nothing", async () => {
      const db = seed();
      const res = await preview(asAgent({ otpCode: "123456", requestId: "req-amina" }));
      expect(res.data).toMatchObject({
        requestId: "req-amina",
        amount: 5_000,
        currency: "USD",
        customerName: "Amina Yusuf",
      });
      expect(res.data.expiresInSeconds).toBeGreaterThan(500);
      expect(journalEntries(db)).toHaveLength(0);
      expect(db.get("agentTopupRequests/req-amina")!.status).toBe("pending");
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(FLOAT);
    });

    it("finds the request by the customer's phone number, typed any usual way", async () => {
      seed();
      for (const customerPhone of ["0634120987", "+252 63 412 0987", "634120987"]) {
        const res = await preview(asAgent({ otpCode: "123456", customerPhone }));
        expect(res.data.requestId).toBe("req-amina");
      }
    });

    it("records which agent was shown the request", async () => {
      const db = seed();
      await preview(asAgent({ otpCode: "123456", requestId: "req-amina" }));
      const req = db.get("agentTopupRequests/req-amina")!;
      expect(req.scannedBy).toBe(AGENT);
      expect(req.scannedAt).toBeDefined();
    });

    it("refuses a bare code", async () => {
      seed();
      await expect(preview(asAgent({ otpCode: "123456" }))).rejects.toMatchObject({
        code: "failed-precondition",
        details: { reason: "target_required" },
      });
    });

    it("says nothing about a request when the code is wrong, and counts the guess", async () => {
      const db = seed();
      await expect(
        preview(asAgent({ otpCode: "654321", requestId: "req-amina" }))
      ).rejects.toMatchObject({ code: "not-found" });
      await expect(
        preview(asAgent({ otpCode: "123456", requestId: "no-such-request" }))
      ).rejects.toMatchObject({ code: "not-found" });
      expect(db.get(`users/${AGENT}`)!.agentOtpFailedAttempts).toBe(2);
      expect(db.get("agentTopupRequests/req-amina")!.scannedBy).toBeUndefined();
    });

    it("locks an agent out after five wrong codes, even with the right one after", async () => {
      seed();
      for (let i = 0; i < 5; i++) {
        await expect(
          preview(asAgent({ otpCode: "000000", requestId: "req-amina" }))
        ).rejects.toMatchObject({ code: "not-found" });
      }
      await expect(
        preview(asAgent({ otpCode: "123456", requestId: "req-amina" }))
      ).rejects.toMatchObject({ code: "resource-exhausted" });
    });

    it("tells the agent their float is short before they take the cash", async () => {
      const db = seed({
        [`ledger_balances/agent:${AGENT}`]: { account: `agent:${AGENT}`, balance: 4_999, currency: "USD" },
      });
      await expect(
        preview(asAgent({ otpCode: "123456", requestId: "req-amina" }))
      ).rejects.toMatchObject({ code: "failed-precondition", details: { reason: "insufficient_float" } });
      expect(db.get("agentTopupRequests/req-amina")!.scannedBy).toBeUndefined();
    });

    it("is for agents only", async () => {
      seed();
      await expect(
        preview(asAgent({ otpCode: "123456", requestId: "req-amina" }, BASHIR))
      ).rejects.toMatchObject({ code: "permission-denied" });
      await expect(preview({ data: { otpCode: "123456", requestId: "req-amina" } })).rejects.toThrow();
    });

    it("refuses an expired code and closes the request", async () => {
      const db = seed({
        "agentTopupRequests/req-amina": request(AMINA, 5_000, "123456", {
          expiresAt: Timestamp.fromMillis(Date.now() - 1_000),
        }),
      });
      await expect(
        preview(asAgent({ otpCode: "123456", requestId: "req-amina" }))
      ).rejects.toThrow(/expired/);
      expect(db.get("agentTopupRequests/req-amina")!.status).toBe("expired");
    });
  });

  describe("agentConfirmTopup", () => {
    const data = (extra: Record<string, unknown> = {}) => ({
      otpCode: "123456",
      agentPin: "246810",
      requestId: "req-amina",
      expectedAmount: 5_000,
      ...extra,
    });

    it("pays out exactly what the agent was shown", async () => {
      const db = seed();
      const res = await confirm(asAgent(data()));
      expect(res.data).toMatchObject({ amount: 5_000, customerName: "Amina Yusuf", commission: 100 });
      expect(db.get(`wallets/${AMINA}`)!.balance).toBe(5_000);
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(FLOAT - 5_000);
      expect(db.get("journal_entries/agenttopup_req-amina")).toBeDefined();
      expect(db.get("agentTopupRequests/req-amina")).toMatchObject({ status: "completed", agentId: AGENT });
    });

    it("refuses when the request is for more than the agent was shown, and posts nothing", async () => {
      // The customer asked for $500 and handed over $50.
      const db = seed({ "agentTopupRequests/req-amina": request(AMINA, 50_000, "123456") });
      await expect(confirm(asAgent(data({ expectedAmount: 5_000 })))).rejects.toMatchObject({
        code: "failed-precondition",
        details: { reason: "amount_mismatch" },
      });
      expect(journalEntries(db)).toHaveLength(0);
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(FLOAT);
      expect(db.get(`wallets/${AMINA}`)!.balance).toBe(0);
      // Still the customer's to use, at its real amount.
      expect(db.get("agentTopupRequests/req-amina")!.status).toBe("pending");
    });

    it("refuses a build that sends no amount", async () => {
      const db = seed();
      for (const expectedAmount of [undefined, 0, -5, 50.5, "5000"]) {
        await expect(confirm(asAgent(data({ expectedAmount })))).rejects.toMatchObject({
          code: "failed-precondition",
          details: { reason: "amount_required" },
        });
      }
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("refuses a bare code: every confirm names one request", async () => {
      const db = seed();
      await expect(
        confirm(asAgent({ otpCode: "123456", agentPin: "246810", expectedAmount: 5_000 }))
      ).rejects.toMatchObject({ code: "failed-precondition", details: { reason: "target_required" } });
      expect(journalEntries(db)).toHaveLength(0);
    });

    it("credits the customer who was named when two customers hold the same code", async () => {
      // Codes are random, so two waiting customers can be shown the same one.
      // By code alone the agent's cash could land on either.
      const db = seed({ "agentTopupRequests/req-bashir": request(BASHIR, 2_000, "123456") });

      await confirm(asAgent(data({ requestId: "req-bashir", expectedAmount: 2_000 })));
      expect(db.get(`wallets/${BASHIR}`)!.balance).toBe(2_000);
      expect(db.get(`wallets/${AMINA}`)!.balance).toBe(0);
      expect(db.get("agentTopupRequests/req-amina")!.status).toBe("pending");

      await confirm(asAgent(data({ requestId: undefined, customerPhone: "0634120987" })));
      expect(db.get(`wallets/${AMINA}`)!.balance).toBe(5_000);
    });

    it("refuses another customer's code against the named request", async () => {
      const db = seed({ "agentTopupRequests/req-bashir": request(BASHIR, 2_000, "777777") });
      await expect(
        confirm(asAgent(data({ otpCode: "777777", requestId: "req-amina", expectedAmount: 2_000 })))
      ).rejects.toMatchObject({ code: "not-found" });
      expect(journalEntries(db)).toHaveLength(0);
      expect(db.get(`users/${AGENT}`)!.agentOtpFailedAttempts).toBe(1);
    });

    it("can't confirm the same request twice", async () => {
      const db = seed();
      await confirm(asAgent(data()));
      await expect(confirm(asAgent(data()))).rejects.toMatchObject({ code: "not-found" });
      expect(journalEntries(db)).toHaveLength(1);
      expect(db.get(`ledger_balances/agent:${AGENT}`)!.balance).toBe(FLOAT - 5_000);
    });

    it("asks for the PIN before any code is tried", async () => {
      mockedPin.mockResolvedValue(false);
      const db = seed();
      await expect(confirm(asAgent(data()))).rejects.toThrow(/Invalid PIN/);
      expect(db.get(`users/${AGENT}`)!.agentOtpFailedAttempts).toBeUndefined();
      expect(journalEntries(db)).toHaveLength(0);
    });
  });

  describe("cash taken, top-up never confirmed", () => {
    const lapsed = (extra: Record<string, any> = {}) =>
      request(AMINA, 5_000, "123456", {
        status: "expired",
        expiresAt: Timestamp.fromMillis(Date.now() - 60_000),
        ...extra,
      });

    const raise = () =>
      openDispute({
        data: {
          agentTopupRequestId: "req-amina",
          kind: "cash_given_not_credited",
          note: "I gave the agent $50 and my balance never changed",
        },
        auth: { uid: AMINA },
      });

    it("goes to the agent whose app was shown the request", async () => {
      const db = seed({
        "agentTopupRequests/req-amina": lapsed({ scannedBy: AGENT, scannedAt: Timestamp.now() }),
      });
      const res = await raise();
      expect(res.data.status).toBe("open");
      expect(db.get(`disputes/${res.data.disputeId}`)).toMatchObject({
        against: AGENT,
        participants: [AMINA, AGENT],
        disputedKind: "uncredited_cash_in",
        amountCents: 5_000,
      });
    });

    it("still goes straight to ops when no agent ever scanned it", async () => {
      const db = seed({ "agentTopupRequests/req-amina": lapsed() });
      const res = await raise();
      expect(res.data.status).toBe("under_review");
      expect(db.get(`disputes/${res.data.disputeId}`)).toMatchObject({ against: null, participants: [AMINA] });
    });
  });
});

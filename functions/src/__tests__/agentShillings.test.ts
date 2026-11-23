import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/limits", () => ({
  enforceTransactionLimits: jest.fn().mockResolvedValue(undefined),
  enforcePerTransactionLimit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/velocity", () => ({ enforceVelocity: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../referral/referralBonus", () => ({ maybeUnlockReferral: jest.fn().mockResolvedValue(false) }));

import { verifyUserPin } from "../auth/validatePin";
import { enforcePerTransactionLimit, enforceTransactionLimits } from "../utils/limits";
import { maybeUnlockReferral } from "../referral/referralBonus";
import { clearRatesCache } from "../config/rates";
import { assertAgentAppReads, assertAmountInRange, requestCurrency } from "../topup/agentCurrency";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;
const { Timestamp } = admin.firestore;

const AGENT = "agent-1";
const CUSTOMER = "cust-1";
const READS_BOTH = ["USD", "SLS"];
const SLS_FLOAT = 400_000; // shillings
const USD_FLOAT = 100_000; // $1,000

const pocket = (balance: number) => ({ balance, totalSent: 0, totalReceived: 0 });

/**
 * Cash-in and cash-out at an agent in shillings (SHILLINGS.md,
 * CASH_IN_CASH_OUT.md). A shilling request moves the agent's shilling float
 * and the customer's shilling balance, and nothing in dollars; an agent's app
 * that can't show shillings is never handed one.
 *
 * The ledger is real; PIN, limits, velocity, pushes and the referral bonus
 * are stubbed.
 */
describe("agent cash-in and cash-out in shillings", () => {
  let askTopup: any;
  let preview: any;
  let confirmTopup: any;
  let askCashOut: any;
  let confirmCashOut: any;
  let cancelCashOut: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    askTopup = test.wrap((await import("../topup/customerRequestAgentTopup")).customerRequestAgentTopup);
    const topup = await import("../topup/agentConfirmTopup");
    preview = test.wrap(topup.previewAgentTopup);
    confirmTopup = test.wrap(topup.agentConfirmTopup);
    askCashOut = test.wrap((await import("../topup/customerCashOut")).customerCashOut);
    confirmCashOut = test.wrap((await import("../topup/agentConfirmCashOut")).agentConfirmCashOut);
    cancelCashOut = test.wrap((await import("../topup/cancelCashOut")).cancelCashOut);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
    clearRatesCache();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Hodan's Shop", kycStatus: "verified" },
      [`users/${CUSTOMER}`]: {
        accountType: "customer",
        fullName: "Amina Yusuf",
        kycStatus: "verified",
        phoneNumber: "+252634120987",
      },
      [`wallets/${AGENT}`]: wallet(0),
      [`wallets/${CUSTOMER}`]: wallet(5_000, { sls: pocket(100_000) }),
      [`ledger_balances/agent:${AGENT}`]: { account: `agent:${AGENT}`, balance: USD_FLOAT, currency: "USD" },
      [`ledger_balances/agent:${AGENT}@SLS`]: { account: `agent:${AGENT}`, balance: SLS_FLOAT, currency: "SLS" },
      "config/rates": { slsPerUsd: 8_000, cashInCommissionRate: 0.01, cashOutCommissionRate: 0.01 },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const topupRequest = (amount: number, currency: string, extra: Record<string, any> = {}) => ({
    customerId: CUSTOMER,
    amount,
    currency,
    otpCode: "123456",
    status: "pending",
    expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
    createdAt: Timestamp.now(),
    ...extra,
  });

  const asAgent = (data: Record<string, unknown>) => ({ data, auth: { uid: AGENT } });
  const asCustomer = (data: Record<string, unknown>) => ({ data, auth: { uid: CUSTOMER } });
  const slsFloat = (db: FakeDb) => db.get(`ledger_balances/agent:${AGENT}@SLS`)!.balance;
  const usdFloat = (db: FakeDb) => db.get(`ledger_balances/agent:${AGENT}`)!.balance;
  const customer = (db: FakeDb) => db.get(`wallets/${CUSTOMER}`)!;

  describe("helpers", () => {
    it("reads an absent currency as dollars, and refuses anything else", () => {
      expect(requestCurrency(undefined)).toBe("USD");
      expect(requestCurrency("SLSH")).toBe("SLS");
      expect(() => requestCurrency("EUR")).toThrow(/USD or SLS/);
    });

    it("compares a shilling amount with dollar limits at the rate", () => {
      // 7,000 shillings is under $1 at 8,000 a dollar; 8,000 is exactly $1.
      expect(() => assertAmountInRange(7_000, "SLS", 8_000, 100, 100_000, "top-up")).toThrow(/Minimum top-up is \$1.00/);
      expect(() => assertAmountInRange(8_000, "SLS", 8_000, 100, 100_000, "top-up")).not.toThrow();
      expect(() => assertAmountInRange(8_000_008, "SLS", 8_000, 100, 100_000, "top-up")).toThrow(/Maximum/);
    });

    it("lets dollars through to any app, shillings only to one that reads them", () => {
      expect(() => assertAgentAppReads("USD", undefined)).not.toThrow();
      expect(() => assertAgentAppReads("SLS", undefined)).toThrow(/Update Zapp Pay Merchant/);
      expect(() => assertAgentAppReads("SLS", ["USD"])).toThrow(/Update Zapp Pay Merchant/);
      expect(() => assertAgentAppReads("SLS", READS_BOTH)).not.toThrow();
    });
  });

  describe("cash-in", () => {
    it("records the currency the customer asked for, and checks the limit in it", async () => {
      const db = seed();
      const res = await askTopup(asCustomer({ amount: 30_000, currency: "SLS" }));
      expect(res.data).toMatchObject({ amount: 30_000, currency: "SLS" });
      expect(db.get(`agentTopupRequests/${res.data.requestId}`)!.currency).toBe("SLS");
      expect(enforcePerTransactionLimit).toHaveBeenCalledWith(30_000, expect.anything(), "SLS");
    });

    it("still makes dollar requests for an app that sends no currency", async () => {
      const db = seed();
      const res = await askTopup(asCustomer({ amount: 2_500 }));
      expect(res.data.currency).toBe("USD");
      expect(db.get(`agentTopupRequests/${res.data.requestId}`)!.currency).toBe("USD");
    });

    it("refuses a shilling amount under the dollar minimum", async () => {
      seed();
      await expect(askTopup(asCustomer({ amount: 5_000, currency: "SLS" }))).rejects.toThrow(/Minimum top-up/);
    });

    it("won't show a shilling request to an app that can't read shillings", async () => {
      seed({ "agentTopupRequests/req-1": topupRequest(30_000, "SLS") });
      await expect(preview(asAgent({ otpCode: "123456", requestId: "req-1" }))).rejects.toMatchObject({
        code: "failed-precondition",
        details: { reason: "update_for_shillings" },
      });
    });

    it("checks shilling float, not dollar float, before the agent takes the cash", async () => {
      seed({
        "agentTopupRequests/req-1": topupRequest(30_000, "SLS"),
        [`ledger_balances/agent:${AGENT}@SLS`]: { account: `agent:${AGENT}`, balance: 29_999, currency: "SLS" },
      });
      // $1,000 of dollar float doesn't help: nothing is converted.
      await expect(
        preview(asAgent({ otpCode: "123456", requestId: "req-1", currencies: READS_BOTH }))
      ).rejects.toMatchObject({ details: { reason: "insufficient_float", currency: "SLS" } });
    });

    it("pays a shilling cash-in from shilling float into the shilling balance", async () => {
      const db = seed({ "agentTopupRequests/req-1": topupRequest(30_000, "SLS") });
      const shown = await preview(asAgent({ otpCode: "123456", requestId: "req-1", currencies: READS_BOTH }));
      expect(shown.data).toMatchObject({ amount: 30_000, currency: "SLS" });

      const res = await confirmTopup(
        asAgent({
          otpCode: "123456",
          requestId: "req-1",
          agentPin: "123456",
          expectedAmount: 30_000,
          expectedCurrency: "SLS",
          currencies: READS_BOTH,
        })
      );
      expect(res.data).toMatchObject({ amount: 30_000, currency: "SLS", commission: 300 });

      expect(slsFloat(db)).toBe(SLS_FLOAT - 30_000);
      expect(usdFloat(db)).toBe(USD_FLOAT);
      expect(customer(db).sls.balance).toBe(130_000);
      expect(customer(db).balance).toBe(5_000);
      // Commission is paid in shillings, to the agent's own wallet.
      expect(db.get(`wallets/${AGENT}`)!.sls.balance).toBe(300);
      expect(db.get(`wallets/${AGENT}`)!.balance).toBe(0);

      const entry = db.get("journal_entries/agenttopup_req-1")!;
      expect(entry.currency).toBe("SLS");
      const row = db.get(`transactions/${res.data.confirmationId}`)!;
      expect(row).toMatchObject({ currency: "SLS", amount: 30_000, kind: "cash_in" });
      // The referral minimum is in dollars: 30,000 shillings counts as $3.75.
      expect(maybeUnlockReferral).toHaveBeenCalledWith(CUSTOMER, { kind: "cash_in", amountCents: 375 });
    });

    it("refuses a confirm whose shown currency doesn't match the request", async () => {
      const db = seed({ "agentTopupRequests/req-1": topupRequest(30_000, "SLS") });
      for (const expectedCurrency of [undefined, "USD"]) {
        await expect(
          confirmTopup(
            asAgent({
              otpCode: "123456",
              requestId: "req-1",
              agentPin: "123456",
              expectedAmount: 30_000,
              expectedCurrency,
              currencies: READS_BOTH,
            })
          )
        ).rejects.toMatchObject({ details: { reason: "amount_mismatch" } });
      }
      expect(slsFloat(db)).toBe(SLS_FLOAT);
      expect(db.get("agentTopupRequests/req-1")!.status).toBe("pending");
    });

    it("refuses to confirm a shilling request from an app that can't read shillings", async () => {
      const db = seed({ "agentTopupRequests/req-1": topupRequest(30_000, "SLS") });
      await expect(
        confirmTopup(asAgent({ otpCode: "123456", requestId: "req-1", agentPin: "123456", expectedAmount: 30_000 }))
      ).rejects.toMatchObject({ details: { reason: "update_for_shillings" } });
      expect(slsFloat(db)).toBe(SLS_FLOAT);
    });
  });

  describe("cash-out", () => {
    const ask = (amount: number, currency?: string) =>
      askCashOut(asCustomer({ amount, pin: "123456", ...(currency ? { currency } : {}) }));
    const confirmAs = (db: FakeDb, cashOutId: string, currencies?: string[]) =>
      confirmCashOut(
        asAgent({
          otpCode: db.get(`cashOutRequests/${cashOutId}`)!.otpCode,
          agentPin: "123456",
          cashOutId,
          ...(currencies ? { currencies } : {}),
        })
      );

    it("holds shillings from the shilling balance, and checks limits in shillings", async () => {
      const db = seed();
      const res = await ask(40_000, "SLS");
      expect(res.data).toMatchObject({ amount: 40_000, currency: "SLS" });
      expect(customer(db).sls.balance).toBe(60_000);
      expect(customer(db).balance).toBe(5_000);
      expect(db.get(`cashOutRequests/${res.data.cashOutId}`)!.currency).toBe("SLS");
      expect(enforceTransactionLimits).toHaveBeenCalledWith(CUSTOMER, 40_000, expect.anything(), undefined, "SLS");
    });

    it("refuses more shillings than the shilling balance, whatever the dollars", async () => {
      seed();
      await expect(ask(100_001, "SLS")).rejects.toThrow(/Insufficient balance/);
    });

    it("refuses a shilling amount under the dollar minimum, naming it in shillings", async () => {
      seed();
      await expect(ask(5_000, "SLS")).rejects.toThrow(/Minimum cash-out is 8,000 SLSH/);
    });

    it("still cashes out dollars for an app that sends no currency", async () => {
      const db = seed();
      const res = await ask(2_000);
      expect(res.data.currency).toBe("USD");
      expect(customer(db).balance).toBe(3_000);
      expect(customer(db).sls.balance).toBe(100_000);
    });

    it("pays a shilling cash-out back to the agent as shilling float", async () => {
      const db = seed();
      const { data } = await ask(40_000, "SLS");
      const res = await confirmAs(db, data.cashOutId, READS_BOTH);
      expect(res.data).toMatchObject({ amount: 40_000, currency: "SLS", commission: 400 });
      expect(slsFloat(db)).toBe(SLS_FLOAT + 40_000);
      expect(usdFloat(db)).toBe(USD_FLOAT);
      expect(db.get(`wallets/${AGENT}`)!.sls.balance).toBe(400);
      expect(db.get(`journal_entries/cashout_${data.cashOutId}`)!.currency).toBe("SLS");
      expect(db.get(`cashOutRequests/${data.cashOutId}`)!.status).toBe("completed");
    });

    it("keeps a shilling cash-out held when the agent's app can't show shillings", async () => {
      const db = seed();
      const { data } = await ask(40_000, "SLS");
      await expect(confirmAs(db, data.cashOutId)).rejects.toMatchObject({
        details: { reason: "update_for_shillings" },
      });
      expect(db.get(`cashOutRequests/${data.cashOutId}`)!.status).toBe("pending");
      expect(slsFloat(db)).toBe(SLS_FLOAT);
      expect(customer(db).sls.balance).toBe(60_000);
    });

    it("returns cancelled shillings to the shilling balance, and says so in shillings", async () => {
      const db = seed();
      const { data } = await ask(40_000, "SLS");
      await cancelCashOut(asCustomer({ cashOutId: data.cashOutId }));
      expect(customer(db).sls.balance).toBe(100_000);
      expect(customer(db).balance).toBe(5_000);
      expect(db.get(`journal_entries/cashoutrelease_${data.cashOutId}`)!.currency).toBe("SLS");
      const { notifyUser } = jest.requireMock("../utils/notifications");
      expect(notifyUser).toHaveBeenCalledWith(
        CUSTOMER,
        "cashout_returned",
        { key: "cashout.returned.cancelled", params: { amount: "SLSH 40,000" } },
        expect.anything()
      );
    });
  });

  describe("float desk", () => {
    let requestFloat: any;
    let approveFloat: any;

    beforeAll(async () => {
      const desk = await import("../admin/floatDesk");
      requestFloat = test.wrap(desk.adminRequestFloat);
      approveFloat = test.wrap(desk.adminApproveFloat);
    });

    const adminAuth = (uid: string) => ({
      uid,
      token: {
        email: `${uid}@zapp.example`,
        admin: true,
        adminRoles: ["ops"],
        auth_time: Math.floor(Date.now() / 1000) - 30,
      },
    });
    const ask = (data: Record<string, unknown>) =>
      requestFloat({
        data: { agentId: AGENT, direction: "issue", route: "cash", reason: "cash paid at the office", ...data },
        auth: adminAuth("admin-1"),
      });

    it("issues shilling float into the agent's shilling float, not dollars", async () => {
      const db = seed({ "config/rates": { slsPerUsd: 8_000, floatApprovalThresholdCents: 50_000_00 } });
      const { data } = await ask({ amountCents: 800_000, currency: "SLS" });
      expect(db.get(`floatIssuances/${data.issuanceId}`)!.currency).toBe("SLS");

      await approveFloat({ data: { issuanceId: data.issuanceId, reason: "checked the cash" }, auth: adminAuth("admin-2") });
      expect(slsFloat(db)).toBe(SLS_FLOAT + 800_000);
      expect(usdFloat(db)).toBe(USD_FLOAT);
      expect(db.get(`journal_entries/float_issue_${data.issuanceId}`)!.currency).toBe("SLS");
      expect(db.get(`transactions/float_issue_${data.issuanceId}`)!.currency).toBe("SLS");
      // adminListAgentFloat's shilling column uses getAll, which the fake
      // database doesn't have; it is checked in the console instead.
    });

    it("counts shillings against the dollar cap and second-approver threshold", async () => {
      // $1,000 threshold; 8,000,000 shillings is $1,000 at 8,000 a dollar.
      seed({ "config/rates": { slsPerUsd: 8_000, floatApprovalThresholdCents: 1_000_00 } });
      const small = await ask({ amountCents: 4_000_000, currency: "SLS" });
      expect(small.data.requiresSecondApprover).toBe(false);
      const second = await ask({ amountCents: 4_000_000, currency: "SLS" });
      expect(second.data.requiresSecondApprover).toBe(true);
      // $100,000 cap: 800,000,008 shillings is just over.
      await expect(ask({ amountCents: 800_000_008, currency: "SLS" })).rejects.toThrow(/capped/);
    });

    it("refuses an unknown currency", async () => {
      seed();
      await expect(ask({ amountCents: 1_000, currency: "EUR" })).rejects.toThrow(/USD or SLS/);
    });
  });
});

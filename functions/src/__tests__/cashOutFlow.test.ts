import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Cash-out hardening: everything here rejects before Firestore is touched.
 * The hold/release/settle paths need the emulator suite (blocked on Java
 * in this environment); their ledger shape is covered by the ledger tests.
 */
const auth = (uid = "agent-1") => ({
  uid,
  token: { email: "a@zapp.example", auth_time: Math.floor(Date.now() / 1000) - 30 },
});

let confirm: any;
let cancel: any;
let mod: typeof import("../topup/agentConfirmCashOut");

beforeAll(async () => {
  if (!admin.apps.length) admin.initializeApp();
  mod = await import("../topup/agentConfirmCashOut");
  confirm = test.wrap(mod.agentConfirmCashOut);
  cancel = test.wrap((await import("../topup/cancelCashOut")).cancelCashOut);
});

afterAll(() => test.cleanup());

describe("agentConfirmCashOut", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(confirm({ data: { otpCode: "123456", agentPin: "123456", cashOutId: "x" } })).rejects.toThrow();
  });

  it("requires a 6-digit code", async () => {
    for (const otpCode of ["", "12345", "1234567", "12a456", 123456]) {
      await expect(
        confirm({ data: { otpCode, agentPin: "123456", cashOutId: "x" }, auth: auth() })
      ).rejects.toThrow(/6-digit/);
    }
  });

  it("requires the agent PIN", async () => {
    await expect(
      confirm({ data: { otpCode: "123456", cashOutId: "x" }, auth: auth() })
    ).rejects.toThrow(/PIN/);
  });

  it("refuses a bare code: every attempt must target one request", async () => {
    // A code alone let colluding agents pool guesses across every pending cash-out.
    await expect(
      confirm({ data: { otpCode: "123456", agentPin: "123456" }, auth: auth() })
    ).rejects.toThrow(/QR|phone number/);
  });

  it("caps wrong codes per request at 5", () => {
    expect(mod.MAX_CODE_ATTEMPTS_PER_REQUEST).toBe(5);
  });
});

describe("normaliseCustomerPhone", () => {
  it("accepts every way an agent might type a Somaliland number", () => {
    for (const raw of ["+252634120987", "0634120987", "634120987", "00252634120987", "252 63 412 0987"]) {
      expect(mod.normaliseCustomerPhone(raw)).toBe("+252634120987");
    }
  });

  it("keeps another country's number when typed with +", () => {
    expect(mod.normaliseCustomerPhone("+44 7507 123456")).toBe("+447507123456");
  });

  it("rejects what is not a phone number", () => {
    for (const raw of ["", "abc", "12", "+1"]) {
      expect(mod.normaliseCustomerPhone(raw)).toBeNull();
    }
  });
});

describe("cancelCashOut", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(cancel({ data: { cashOutId: "x" } })).rejects.toThrow();
  });

  it("requires a well-formed cash-out id", async () => {
    for (const cashOutId of [undefined, "", "a/b", 42]) {
      await expect(cancel({ data: { cashOutId }, auth: auth("cust-1") })).rejects.toThrow(/cashOutId/);
    }
  });
});

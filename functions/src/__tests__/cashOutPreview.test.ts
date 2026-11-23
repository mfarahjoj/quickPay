import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const { Timestamp } = admin.firestore;
const CUSTOMER = "cust";
const CODE = "424242";

/**
 * The agent used to learn how much cash to hand over only after the money
 * had moved. previewAgentCashOut says it first, and the confirm refuses if
 * the request no longer matches what the agent was shown.
 */
describe("previewAgentCashOut", () => {
  let preview: any;
  let confirm: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../topup/agentConfirmCashOut");
    preview = test.wrap(mod.previewAgentCashOut);
    confirm = test.wrap(mod.agentConfirmCashOut);
  });
  beforeEach(() => mockedPin.mockReset().mockResolvedValue(true));
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const seed = (cashOut: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      "users/a1": { accountType: "topup_agent", fullName: "Agent a1" },
      "wallets/a1": wallet(0),
      "users/shop": { accountType: "merchant", fullName: "Shop" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina Warsame", phoneNumber: "+252634120987" },
      [`wallets/${CUSTOMER}`]: wallet(0),
      "ledger_balances/platform:cashout_hold": { balance: 5_000 },
      "cashOutRequests/co1": {
        customerId: CUSTOMER,
        amount: 5_000,
        currency: "USD",
        otpCode: CODE,
        status: "pending",
        failedAttempts: 0,
        expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
        createdAt: Timestamp.now(),
        ...cashOut,
      },
    });
    restore = useFakeFirestore(db);
    return db;
  };
  const journal = (db: FakeDb) => [...db.store.keys()].filter((p) => p.startsWith("journal_entries/"));

  it("shows the amount and customer for the right code, without moving money or asking for the PIN", async () => {
    const db = seed();
    const res = await preview({ data: { otpCode: CODE, customerPhone: "0634120987" }, auth: { uid: "a1" } });
    expect(res.data).toEqual({ cashOutId: "co1", amount: 5_000, currency: "USD", customerName: "Amina Warsame" });
    expect(mockedPin).not.toHaveBeenCalled();
    expect(db.get("cashOutRequests/co1")).toMatchObject({ status: "pending", failedAttempts: 0 });
    expect(journal(db)).toHaveLength(0);
  });

  it("counts a wrong code like a confirm attempt", async () => {
    const db = seed();
    await expect(preview({ data: { otpCode: "000000", cashOutId: "co1" }, auth: { uid: "a1" } })).rejects.toMatchObject({
      code: "not-found",
    });
    expect(db.get("cashOutRequests/co1")).toMatchObject({ failedAttempts: 1, attemptsBy: { a1: 1 } });
  });

  it("is for agents only", async () => {
    seed();
    await expect(preview({ data: { otpCode: CODE, cashOutId: "co1" }, auth: { uid: "shop" } })).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("pays out when the confirm carries the amount the agent was shown", async () => {
    const db = seed();
    await confirm({
      data: { otpCode: CODE, cashOutId: "co1", agentPin: "246810", expectedAmount: 5_000, expectedCurrency: "USD" },
      auth: { uid: "a1" },
    });
    expect(db.get("cashOutRequests/co1")!.status).toBe("completed");
  });

  it("refuses, before any money moves, when the amount shown doesn't match", async () => {
    const db = seed();
    await expect(
      confirm({ data: { otpCode: CODE, cashOutId: "co1", agentPin: "246810", expectedAmount: 500 }, auth: { uid: "a1" } })
    ).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(
      confirm({
        data: { otpCode: CODE, cashOutId: "co1", agentPin: "246810", expectedAmount: 5_000, expectedCurrency: "SLS" },
        auth: { uid: "a1" },
      })
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(db.get("cashOutRequests/co1")!.status).toBe("pending");
    expect(journal(db)).toHaveLength(0);
  });
});

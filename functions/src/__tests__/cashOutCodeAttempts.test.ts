import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import {
  MAX_CODE_ATTEMPTS_PER_AGENT,
  MAX_CODE_ATTEMPTS_PER_REQUEST,
} from "../topup/agentConfirmCashOut";
const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const { Timestamp } = admin.firestore;
const CUSTOMER = "cust";
const CODE = "424242";

/**
 * A cash-out's code can be tried five times in all before the money goes
 * back. One agent used to be able to use all five, so anyone who knew a
 * customer's phone number could cancel their cash-out from behind a counter
 * across town. Each agent now gets three, and every try is on record.
 */
describe("cash-out code attempts, per agent", () => {
  let confirm: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    confirm = test.wrap((await import("../topup/agentConfirmCashOut")).agentConfirmCashOut);
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

  const seed = (cashOut: Record<string, any> = {}): FakeDb => {
    const agents: Record<string, any> = {};
    for (const id of ["a1", "a2", "a3"]) {
      agents[`users/${id}`] = { accountType: "topup_agent", fullName: `Agent ${id}` };
      agents[`wallets/${id}`] = wallet(0);
    }
    const db = fakeFirestore({
      ...agents,
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina", phoneNumber: "+252634120987" },
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

  const attempt = (uid: string, otpCode: string, target: Record<string, string> = { cashOutId: "co1" }) =>
    confirm({ data: { otpCode, agentPin: "246810", ...target }, auth: { uid } });

  /** The agent's lockout (5 wrong codes in a row) is a separate guard; keep it out of the way. */
  const unlock = (db: FakeDb, uid: string) =>
    db.store.set(`users/${uid}`, { ...db.get(`users/${uid}`)!, agentOtpFailedAttempts: 0, agentOtpLockedUntil: null });

  it("gives one agent fewer tries than the request has", () => {
    expect(MAX_CODE_ATTEMPTS_PER_AGENT).toBeLessThan(MAX_CODE_ATTEMPTS_PER_REQUEST);
  });

  it("stops one agent at three wrong codes and leaves the cash-out open", async () => {
    const db = seed();
    for (let i = 0; i < MAX_CODE_ATTEMPTS_PER_AGENT; i++) {
      await expect(attempt("a1", "000000")).rejects.toMatchObject({ code: "not-found" });
    }
    // A fourth try is refused without being compared or counted, however often.
    for (let i = 0; i < 4; i++) {
      unlock(db, "a1");
      await expect(attempt("a1", "000000")).rejects.toMatchObject({
        code: "resource-exhausted",
        details: { reason: "agent_code_attempts" },
      });
    }
    const cashOut = db.get("cashOutRequests/co1")!;
    expect(cashOut.status).toBe("pending");
    expect(cashOut.failedAttempts).toBe(3);
    expect(cashOut.attemptsBy).toEqual({ a1: 3 });
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(0); // still held, not returned

    // Even the right code no longer works for that agent...
    unlock(db, "a1");
    await expect(attempt("a1", CODE)).rejects.toMatchObject({ code: "resource-exhausted" });
    // ...and another agent can still pay the customer out.
    await attempt("a2", CODE);
    expect(db.get("cashOutRequests/co1")).toMatchObject({ status: "completed", agentId: "a2" });
    expect(db.get("ledger_balances/agent:a2")!.balance).toBe(5_000);
  });

  it("counts a phone-number lookup against the same request", async () => {
    const db = seed();
    await expect(attempt("a1", "000000", { customerPhone: "0634120987" })).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(attempt("a1", "000000")).rejects.toMatchObject({ code: "not-found" });
    expect(db.get("cashOutRequests/co1")!.attemptsBy).toEqual({ a1: 2 });
  });

  it("records who tried and when", async () => {
    const db = seed();
    await expect(attempt("a1", "000000")).rejects.toMatchObject({ code: "not-found" });
    await expect(attempt("a2", "111111")).rejects.toMatchObject({ code: "not-found" });
    const log = db.get("cashOutRequests/co1")!.attemptLog;
    expect(log.map((e: any) => e.agentId)).toEqual(["a1", "a2"]);
    expect(log.every((e: any) => typeof e.at.toMillis === "function")).toBe(true);
  });

  it("still returns the money after five wrong codes from several agents", async () => {
    const db = seed();
    for (const uid of ["a1", "a1", "a1", "a2", "a2"]) {
      await expect(attempt(uid, "000000")).rejects.toMatchObject({ code: "not-found" });
    }
    const cashOut = db.get("cashOutRequests/co1")!;
    expect(cashOut.status).toBe("cancelled");
    expect(cashOut.releaseReason).toBe("too_many_attempts");
    expect(db.get(`wallets/${CUSTOMER}`)!.balance).toBe(5_000);
    expect(cashOut.attemptsBy).toEqual({ a1: 3, a2: 2 });
  });

  it("doesn't charge an agent a try for the right code", async () => {
    // Two mistypes, then the right code, but the customer was frozen in
    // between: the payout is refused after the code matched.
    const db = seed();
    await expect(attempt("a1", "000000")).rejects.toMatchObject({ code: "not-found" });
    await expect(attempt("a1", "111111")).rejects.toMatchObject({ code: "not-found" });
    db.store.set(`users/${CUSTOMER}`, { ...db.get(`users/${CUSTOMER}`)!, accountStatus: "frozen" });
    for (let i = 0; i < 3; i++) {
      await expect(attempt("a1", CODE)).rejects.toMatchObject({ code: "permission-denied" });
    }
    expect(db.get("cashOutRequests/co1")).toMatchObject({
      status: "pending",
      failedAttempts: 2,
      attemptsBy: { a1: 2 },
    });

    // Unfrozen, the same agent's right code pays out: retries cost nothing.
    db.store.set(`users/${CUSTOMER}`, { ...db.get(`users/${CUSTOMER}`)!, accountStatus: "active" });
    await attempt("a1", CODE);
    expect(db.get("cashOutRequests/co1")!.status).toBe("completed");
  });

  it("pays out on an agent's third try when it is the right one", async () => {
    const db = seed();
    await expect(attempt("a1", "000000")).rejects.toMatchObject({ code: "not-found" });
    await expect(attempt("a1", "111111")).rejects.toMatchObject({ code: "not-found" });
    await attempt("a1", CODE);
    expect(db.get("cashOutRequests/co1")).toMatchObject({ status: "completed", agentId: "a1" });
  });
});

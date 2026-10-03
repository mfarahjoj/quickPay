import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

// The PIN compare is the guess an attacker is buying, so it is the thing to
// count. Everything else — the transactions, lockout fields, ledger — is real.
const GOOD_PIN = "246810";
jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  verifyPin: jest.fn(async (pin: string) => pin === "246810"),
}));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
}));

import { verifyPin } from "../utils/encryption";
import { verifyUserPin } from "../auth/validatePin";

const mockedCompare = verifyPin as jest.MockedFunction<typeof verifyPin>;
const { Timestamp } = admin.firestore;
const PARALLEL = 20;

/** Settle every promise and sort the outcomes into buckets. */
async function outcomes(calls: Array<Promise<unknown>>) {
  const settled = await Promise.allSettled(calls);
  const count = (pred: (r: PromiseSettledResult<unknown>) => boolean) => settled.filter(pred).length;
  const code = (r: PromiseSettledResult<unknown>) =>
    r.status === "rejected" ? (r.reason as any)?.code : undefined;
  return {
    fulfilled: settled.filter((r) => r.status === "fulfilled").map((r: any) => r.value),
    exhausted: count((r) => code(r) === "resource-exhausted"),
    notFound: count((r) => code(r) === "not-found"),
    denied: count((r) => code(r) === "permission-denied"),
  };
}

/**
 * Every lockout here used to check the lock, compare, and only then record
 * the failure. A burst of parallel requests all saw "not locked" and all got
 * a guess. Each now reserves the attempt in a transaction first; these fire
 * PARALLEL requests at once and count how many guesses got through.
 */
describe("lockouts hold under parallel requests", () => {
  let restore: (() => void) | undefined;

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  beforeEach(() => mockedCompare.mockClear());
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const seed = (docs: Record<string, any>): FakeDb => {
    const db = fakeFirestore(docs);
    restore = useFakeFirestore(db);
    return db;
  };

  describe("PIN (verifyUserPin, behind every payment and login)", () => {
    it("lets only five guesses through a burst, then locks", async () => {
      const db = seed({ "users/u1": { pinHash: "h" } });

      const result = await outcomes(
        Array.from({ length: PARALLEL }, () => verifyUserPin("u1", "000000"))
      );

      expect(mockedCompare).toHaveBeenCalledTimes(5);
      expect(result.fulfilled).toEqual([false, false, false, false, false]);
      expect(result.exhausted).toBe(PARALLEL - 5);
      expect(db.get("users/u1")!.pinFailedAttempts).toBe(5);
      expect(db.get("users/u1")!.pinLockedUntil.toMillis()).toBeGreaterThan(Date.now());
    });

    it("gives the reservation back on a correct PIN", async () => {
      const db = seed({ "users/u1": { pinHash: "h", pinFailedAttempts: 3 } });
      await expect(verifyUserPin("u1", GOOD_PIN)).resolves.toBe(true);
      expect(db.get("users/u1")!.pinFailedAttempts).toBe(0);
      expect(db.get("users/u1")!.pinLockedUntil).toBeNull();
    });

    it("still refuses, without a compare, while locked", async () => {
      seed({
        "users/u1": { pinHash: "h", pinLockedUntil: Timestamp.fromMillis(Date.now() + 60_000) },
      });
      await expect(verifyUserPin("u1", GOOD_PIN)).rejects.toMatchObject({
        code: "resource-exhausted",
      });
      expect(mockedCompare).not.toHaveBeenCalled();
    });
  });

  describe("agent codes (agentConfirmTopup)", () => {
    it("lets one agent look up only five codes from a burst", async () => {
      const confirm = test.wrap((await import("../topup/agentConfirmTopup")).agentConfirmTopup);
      const db = seed({
        "users/agent": { accountType: "topup_agent", pinHash: "h", kycStatus: "verified" },
        "wallets/agent": wallet(100_000),
      });

      const result = await outcomes(
        Array.from({ length: PARALLEL }, (_, i) =>
          confirm({
            data: { otpCode: String(100000 + i), agentPin: GOOD_PIN },
            auth: { uid: "agent" },
          })
        )
      );

      expect(result.notFound).toBe(5);
      expect(result.exhausted).toBe(PARALLEL - 5);
      expect(db.get("users/agent")!.agentOtpFailedAttempts).toBe(5);
    });
  });

  describe("one cash-out's code (agentConfirmCashOut)", () => {
    it("compares at most five codes from many agents at once, then returns the money once", async () => {
      const confirm = test.wrap(
        (await import("../topup/agentConfirmCashOut")).agentConfirmCashOut
      );
      const agents: Record<string, any> = {};
      for (let i = 0; i < PARALLEL; i++) {
        agents[`users/a${i}`] = { accountType: "topup_agent", pinHash: "h" };
        agents[`wallets/a${i}`] = wallet(0);
      }
      const db = seed({
        ...agents,
        "users/cust": { accountType: "customer", fullName: "Amina" },
        "wallets/cust": wallet(0),
        "ledger_balances/platform:cashout_hold": { balance: 5_000 },
        "cashOutRequests/co1": {
          customerId: "cust",
          amount: 5_000,
          currency: "USD",
          otpCode: "424242",
          status: "pending",
          failedAttempts: 0,
          expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
          createdAt: Timestamp.now(),
        },
      });

      const result = await outcomes(
        Array.from({ length: PARALLEL }, (_, i) =>
          confirm({
            data: { otpCode: "000000", agentPin: GOOD_PIN, cashOutId: "co1" },
            auth: { uid: `a${i}` },
          })
        )
      );

      expect(result.notFound).toBe(PARALLEL);
      const cashOut = db.get("cashOutRequests/co1")!;
      expect(cashOut.failedAttempts).toBe(5);
      expect(cashOut.status).toBe("cancelled");
      expect(cashOut.releaseReason).toBe("too_many_attempts");
      // Returned exactly once.
      expect(db.get("wallets/cust")!.balance).toBe(5_000);
      expect(db.get("journal_entries/cashoutrelease_co1")).toBeDefined();

      // And the right code no longer pays anyone.
      await expect(
        confirm({
          data: { otpCode: "424242", agentPin: GOOD_PIN, cashOutId: "co1" },
          auth: { uid: "a0" },
        })
      ).rejects.toMatchObject({ code: "not-found" });
      expect(db.get("wallets/a0")!.balance).toBe(0);
    });

    it("still pays out when the fifth attempt is the right one", async () => {
      const confirm = test.wrap(
        (await import("../topup/agentConfirmCashOut")).agentConfirmCashOut
      );
      const db = seed({
        "users/a0": { accountType: "topup_agent", pinHash: "h", fullName: "Agent" },
        "wallets/a0": wallet(0),
        "users/cust": { accountType: "customer", fullName: "Amina" },
        "wallets/cust": wallet(0),
        "ledger_balances/platform:cashout_hold": { balance: 5_000 },
        "cashOutRequests/co1": {
          customerId: "cust",
          amount: 5_000,
          currency: "USD",
          otpCode: "424242",
          status: "pending",
          failedAttempts: 4,
          expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
          createdAt: Timestamp.now(),
        },
      });

      await confirm({
        data: { otpCode: "424242", agentPin: GOOD_PIN, cashOutId: "co1" },
        auth: { uid: "a0" },
      });
      expect(db.get("cashOutRequests/co1")!.status).toBe("completed");
      expect(db.get("wallets/a0")!.balance).toBe(5_000 + 100);
    });
  });
});

import * as admin from "firebase-admin";
import {
  SETTLEMENT_HOLD,
  userAccount,
  floatAccountForRoute,
  aggregateDeltas,
  validateEntry,
} from "../ledger";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({
  verifyUserPin: jest.fn(),
}));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { clearRatesCache } from "../config/rates";
const mockedVerifyPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const MERCHANT = "merch-1";
const AMOUNT = 25_000; // $250

/**
 * The three payout entries as the callables post them. Asserting on the
 * templates catches the mistake that matters most here — a leg pointing the
 * wrong way, which would create or destroy value rather than move it.
 */
describe("payout journal templates", () => {
  const hold = [
    { account: userAccount(MERCHANT), debit: AMOUNT, credit: 0 },
    { account: SETTLEMENT_HOLD, debit: 0, credit: AMOUNT },
  ];
  const settle = [
    { account: SETTLEMENT_HOLD, debit: AMOUNT, credit: 0 },
    { account: floatAccountForRoute("bank"), debit: 0, credit: AMOUNT },
  ];
  const cancel = [
    { account: SETTLEMENT_HOLD, debit: AMOUNT, credit: 0 },
    { account: userAccount(MERCHANT), debit: 0, credit: AMOUNT },
  ];

  it.each([
    ["hold", hold],
    ["settle", settle],
    ["cancel", cancel],
  ])("%s is a valid zero-sum entry", (_name, lines) => {
    expect(() =>
      validateEntry({
        entryId: "payout_test",
        type: "payout_hold",
        currency: "USD",
        lines,
        description: "test",
        postedBy: MERCHANT,
      })
    ).not.toThrow();
  });

  it("takes the money off the merchant and parks it in the hold", () => {
    const deltas = aggregateDeltas(hold);
    const merchant = deltas.find((d) => d.account === userAccount(MERCHANT));
    const held = deltas.find((d) => d.account === SETTLEMENT_HOLD);
    expect(merchant?.delta).toBe(-AMOUNT);
    expect(held?.delta).toBe(AMOUNT);
  });

  it("empties the hold when the transfer is sent, not the merchant again", () => {
    const deltas = aggregateDeltas(settle);
    expect(deltas.find((d) => d.account === SETTLEMENT_HOLD)?.delta).toBe(-AMOUNT);
    expect(deltas.find((d) => d.account === userAccount(MERCHANT))).toBeUndefined();
    expect(deltas.find((d) => d.account === floatAccountForRoute("bank"))?.delta).toBe(
      AMOUNT
    );
  });

  it("gives a rejected payout back to the merchant", () => {
    const held = aggregateDeltas(hold);
    const returned = aggregateDeltas(cancel);
    const net =
      (held.find((d) => d.account === userAccount(MERCHANT))?.delta ?? 0) +
      (returned.find((d) => d.account === userAccount(MERCHANT))?.delta ?? 0);
    // Requested then rejected must leave the merchant exactly where they were.
    expect(net).toBe(0);
  });
});

describe("requestPayout", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    wrapped = test.wrap((await import("../payouts/requestPayout")).requestPayout);
  });

  let restore: (() => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedVerifyPin.mockResolvedValue(true);
    clearRatesCache();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const ZAAD = { msisdn: "+252634123456", name: "Hooyo Xasan", updatedAt: admin.firestore.Timestamp.now() };
  const seed = (user: Record<string, unknown> = { zaad: ZAAD }): FakeDb => {
    const db = fakeFirestore({
      [`users/${MERCHANT}`]: { accountType: "merchant", fullName: "Hooyo Restaurant", ...user },
      [`wallets/${MERCHANT}`]: wallet(AMOUNT * 2),
      [`merchantProfiles/${MERCHANT}`]: { businessName: "Hooyo Restaurant" },
    });
    restore = useFakeFirestore(db);
    return db;
  };
  const payouts = (db: FakeDb) =>
    [...db.store.entries()].filter(([p]) => p.startsWith("payoutRequests/")).map(([, d]) => d);

  const call = (data: Record<string, unknown> = {}) =>
    wrapped({
      data: {
        amountCents: AMOUNT,
        route: "bank",
        destinationName: "Hooyo Restaurant",
        destinationRef: "0123456789",
        pin: "123456",
        ...data,
      },
      auth: { uid: MERCHANT },
    });

  it("rejects unauthenticated calls", async () => {
    await expect(
      wrapped({ data: { amountCents: AMOUNT, route: "bank", pin: "123456" } })
    ).rejects.toThrow();
  });

  it("requires a PIN", async () => {
    await expect(call({ pin: "" })).rejects.toThrow(/PIN is required/i);
  });

  it("refuses an amount below the floor", async () => {
    await expect(call({ amountCents: 100 })).rejects.toThrow(/Payouts start at/i);
  });

  it("refuses a non-integer amount", async () => {
    await expect(call({ amountCents: 250.5 })).rejects.toThrow(/Payouts start at/i);
  });

  it("sends it to the Zaad account on file, whatever the request names", async () => {
    const db = seed();
    await call({ route: "bank", destinationName: "Someone Else", destinationRef: "999" });
    const [p] = payouts(db);
    expect(p).toMatchObject({
      merchantId: MERCHANT,
      amountCents: AMOUNT,
      route: "zaad",
      destinationName: "Hooyo Xasan",
      destinationRef: "+252634123456",
      status: "requested",
    });
    expect(db.get(`wallets/${MERCHANT}`)!.balance).toBe(AMOUNT);
  });

  it("asks for a Zaad account first", async () => {
    const db = seed({});
    await expect(call()).rejects.toThrow(/Add your Zaad account/i);
    expect(payouts(db)).toHaveLength(0);
    expect(mockedVerifyPin).not.toHaveBeenCalled();
  });

  it("waits after the Zaad number changes", async () => {
    const db = seed({ zaad: { ...ZAAD, changedAt: admin.firestore.Timestamp.now() } });
    await expect(call()).rejects.toThrow(/changed Zaad number 24 hours/i);
    expect(payouts(db)).toHaveLength(0);
  });
});

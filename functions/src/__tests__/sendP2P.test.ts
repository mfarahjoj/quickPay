import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({
  verifyUserPin: jest.fn(),
}));
jest.mock("../utils/notifications", () => ({
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
}));
// Limits and velocity run aggregate queries the in-memory Firestore lacks;
// they have their own tests (limits.test.ts).
jest.mock("../utils/limits", () => ({
  enforceTransactionLimits: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/velocity", () => ({
  enforceVelocity: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
const mockedVerifyPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

describe("sendP2P", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../wallet/sendP2P");
    wrapped = test.wrap(mod.sendP2P);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedVerifyPin.mockResolvedValue(true);
  });

  afterAll(() => {
    test.cleanup();
  });

  it("rejects unauthenticated calls", async () => {
    await expect(
      wrapped({
        data: {
          recipientPhone: "+252631234567",
          amount: 1000,
          currency: "USD",
          pin: "123456",
        },
      })
    ).rejects.toThrow();
  });

  it("rejects missing parameters", async () => {
    await expect(
      wrapped({
        data: { recipientPhone: "", amount: 0, currency: "", pin: "" },
        auth: { uid: "sender-1" },
      })
    ).rejects.toThrow(/required/i);
  });

  it("rejects non-positive amount", async () => {
    await expect(
      wrapped({
        data: {
          recipientPhone: "+252631234567",
          amount: -100,
          currency: "USD",
          pin: "123456",
        },
        auth: { uid: "sender-1" },
      })
    ).rejects.toThrow(/positive/i);
  });

  it("rejects unsupported currency", async () => {
    await expect(
      wrapped({
        data: {
          recipientPhone: "+252631234567",
          amount: 1000,
          currency: "EUR",
          pin: "123456",
        },
        auth: { uid: "sender-1" },
      })
    ).rejects.toThrow(/Currency/i);
  });

  it("rejects invalid PIN", async () => {
    mockedVerifyPin.mockResolvedValue(false);

    await expect(
      wrapped({
        data: {
          recipientPhone: "+252631234567",
          amount: 1000,
          currency: "USD",
          pin: "000000",
        },
        auth: { uid: "sender-1" },
      })
    ).rejects.toThrow(/Invalid PIN/);
  });

  /**
   * A shop is paid by QR, which carries the fee. These run the real ledger,
   * limits and velocity against the in-memory Firestore.
   */
  describe("recipient is a business", () => {
    const SENDER = "sender-1";
    const SHOP_PHONE = "+252630000001";
    const AGENT_SHOP_PHONE = "+252630000002";
    const FRIEND_PHONE = "+252630000003";
    let restore: (() => void) | undefined;

    afterEach(() => {
      restore?.();
      restore = undefined;
    });

    const seed = (): FakeDb => {
      const db = fakeFirestore({
        [`users/${SENDER}`]: { accountType: "customer", fullName: "Amina", kycStatus: "verified" },
        "users/shop-1": { accountType: "merchant", fullName: "Hooyo Shop", phoneNumber: SHOP_PHONE },
        "users/shop-2": {
          accountType: "agent_merchant",
          fullName: "Corner Agent",
          phoneNumber: AGENT_SHOP_PHONE,
        },
        "users/friend-1": { accountType: "customer", fullName: "Ali", phoneNumber: FRIEND_PHONE },
        [`wallets/${SENDER}`]: wallet(10_000),
        "wallets/shop-1": wallet(0),
        "wallets/shop-2": wallet(0),
        "wallets/friend-1": wallet(0),
      });
      restore = useFakeFirestore(db);
      return db;
    };

    const send = (recipientPhone: string) =>
      wrapped({
        data: { recipientPhone, amount: 1000, currency: "USD", pin: "123456" },
        auth: { uid: SENDER },
      });

    const journalEntries = (db: FakeDb) =>
      [...db.store.keys()].filter((p) => p.startsWith("journal_entries/"));

    it.each([
      ["merchant", SHOP_PHONE],
      ["agent_merchant", AGENT_SHOP_PHONE],
    ])("refuses a %s and moves nothing", async (_role, phone) => {
      const db = seed();
      const err = await send(phone).catch((e: any) => e);
      expect(err).toBeInstanceOf(https.HttpsError);
      expect(err.code).toBe("failed-precondition");
      expect(err.details).toEqual({ reason: "recipient_is_merchant" });
      expect(journalEntries(db)).toHaveLength(0);
      expect(db.get(`wallets/${SENDER}`)!.balance).toBe(10_000);
    });

    it("still sends to a person", async () => {
      const db = seed();
      const result = await send(FRIEND_PHONE);
      expect(result.success).toBe(true);
      expect(db.get(`wallets/${SENDER}`)!.balance).toBe(9_000);
      expect(db.get("wallets/friend-1")!.balance).toBe(1_000);
    });
  });
});

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({
  verifyUserPin: jest.fn(),
}));
jest.mock("../utils/notifications", () => ({
  notifyPaymentReceived: jest.fn().mockResolvedValue(undefined),
  notifyPaymentSent: jest.fn().mockResolvedValue(undefined),
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
});

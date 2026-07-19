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

describe("processPayment", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../qr-payments/processPayment");
    wrapped = test.wrap(mod.processPayment);
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
      wrapped({ data: { qrCodeId: "qr-1", pin: "123456" } })
    ).rejects.toThrow();
  });

  it("rejects missing parameters", async () => {
    await expect(
      wrapped({ data: { qrCodeId: "", pin: "" }, auth: { uid: "user-1" } })
    ).rejects.toThrow(/required/i);
  });

  it("rejects invalid PIN", async () => {
    mockedVerifyPin.mockResolvedValue(false);

    await expect(
      wrapped({
        data: { qrCodeId: "qr-1", pin: "000000" },
        auth: { uid: "user-1" },
      })
    ).rejects.toThrow(/Invalid PIN/);
  });
});

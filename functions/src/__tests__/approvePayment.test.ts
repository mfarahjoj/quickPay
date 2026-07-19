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

const mockTimestamp = {
  toMillis: () => Date.now() - 30_000,
};

const basePendingRequest = {
  merchantId: "merchant-1",
  customerId: "customer-1",
  amount: 5000,
  currency: "USD",
  status: "pending",
  createdAt: mockTimestamp,
};

describe("approvePaymentRequest", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../customer-qr/approvePayment");
    wrapped = test.wrap(mod.approvePaymentRequest);
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
      wrapped({ data: { requestId: "req-1", pin: "123456" } })
    ).rejects.toThrow();
  });

  it("rejects missing parameters", async () => {
    await expect(
      wrapped({ data: { requestId: "", pin: "" }, auth: { uid: "customer-1" } })
    ).rejects.toThrow(/required/i);
  });

  it("rejects invalid PIN", async () => {
    mockedVerifyPin.mockResolvedValue(false);

    await expect(
      wrapped({
        data: { requestId: "req-1", pin: "000000" },
        auth: { uid: "customer-1" },
      })
    ).rejects.toThrow(/Invalid PIN/);
  });
});

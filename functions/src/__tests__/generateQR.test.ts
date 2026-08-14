import * as admin from "firebase-admin";
import { generateEmvQRPayload, parseEmvQRPayload } from "../utils/emvqr";

const test = require("firebase-functions-test")();

describe("generateQRCode", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../qr-payments/generateQR");
    wrapped = test.wrap(mod.generateQRCode);
  });

  afterAll(() => {
    test.cleanup();
  });

  it("rejects unauthenticated calls", async () => {
    await expect(
      wrapped({ data: { amount: 1000, currency: "USD" } })
    ).rejects.toThrow();
  });

  it("rejects a non-integer amount", async () => {
    await expect(
      wrapped({
        data: { amount: 10.5, currency: "USD" },
        auth: { uid: "merchant-1" },
      })
    ).rejects.toThrow(/positive integer/i);
  });

  it("rejects an unsupported currency", async () => {
    await expect(
      wrapped({
        data: { amount: 1000, currency: "GBP" },
        auth: { uid: "merchant-1" },
      })
    ).rejects.toThrow(/currency/i);
  });
});

describe("EMV QR payload", () => {
  const base = {
    pointOfInitiation: "12" as const,
    merchantId: "abcdefghijklmnopqrstuvwxyz12",
    qrCodeId: "a".repeat(32),
    merchantCategoryCode: "5999",
    currencyCode: "840",
    countryCode: "SO",
    merchantCity: "Hargeisa",
  };

  it("round-trips the merchant and QR identifiers", () => {
    const payload = generateEmvQRPayload({
      ...base,
      amount: 12.34,
      merchantName: "Hargeisa Electronics",
    });

    const parsed = parseEmvQRPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.merchantId).toBe(base.merchantId);
    expect(parsed!.qrCodeId).toBe(base.qrCodeId);
    expect(parsed!.amount).toBe(12.34);
  });

  it("starts with the EMV header so validateQRCode routes it correctly", () => {
    const payload = generateEmvQRPayload({
      ...base,
      amount: 1,
      merchantName: "Shop",
    });
    // validateQRCode branches on this prefix before trying the encrypted path.
    expect(payload.startsWith("00")).toBe(true);
  });

  it("stays parseable when the merchant name is truncated to the EMV limit", () => {
    // TLV lengths are two digits, so an over-long field corrupts every
    // subsequent tag rather than just its own.
    const longName = "Hargeisa General Trading and Electronics Company";
    const payload = generateEmvQRPayload({
      ...base,
      amount: 5,
      merchantName: longName.slice(0, 25),
    });

    const parsed = parseEmvQRPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.merchantName).toBe(longName.slice(0, 25));
    expect(parsed!.qrCodeId).toBe(base.qrCodeId);
  });

  it("rejects a payload whose checksum does not match", () => {
    const payload = generateEmvQRPayload({
      ...base,
      amount: 9.99,
      merchantName: "Shop",
    });
    const tampered = payload.replace("840", "978");
    expect(parseEmvQRPayload(tampered)).toBeNull();
  });
});

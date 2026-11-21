import * as admin from "firebase-admin";
import { generateEmvQRPayload, parseEmvQRPayload } from "../utils/emvqr";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";
import { expectWireSafe } from "./helpers/wireSafe";

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

  describe("response", () => {
    let restore: () => void;
    afterEach(() => restore?.());

    const generate = async () => {
      const db = fakeFirestore({
        "users/merchant-1": { accountType: "merchant", fullName: "Owner" },
        "merchantProfiles/merchant-1": { businessName: "Hargeisa Electronics" },
      });
      restore = useFakeFirestore(db);
      const before = Date.now();
      const res = await wrapped({
        data: { amount: 1250, currency: "USD" },
        auth: { uid: "merchant-1" },
      });
      return { db, res, before, after: Date.now() };
    };

    it("sends expiresAt as an ISO string ten minutes out", async () => {
      const { res, before, after } = await generate();
      // A Date here reaches the app as {}: the countdown showed NaN:NaN.
      expect(typeof res.data.expiresAt).toBe("string");
      const expiresMs = Date.parse(res.data.expiresAt);
      expect(new Date(expiresMs).toISOString()).toBe(res.data.expiresAt);
      expect(expiresMs).toBeGreaterThanOrEqual(before + 10 * 60_000);
      expect(expiresMs).toBeLessThanOrEqual(after + 10 * 60_000);
    });

    it("holds only values a callable can send", async () => {
      const { res, db } = await generate();
      expectWireSafe(res);
      expect(res).toMatchObject({
        success: true,
        data: {
          qrCodeId: expect.any(String),
          qrData: expect.any(String),
          emvQrData: expect.any(String),
          feeCents: expect.any(Number),
          netCents: expect.any(Number),
          merchantName: "Hargeisa Electronics",
        },
      });
      expect(res.data.feeCents + res.data.netCents).toBe(1250);
      // The stored code expires at the same instant the app counts down to.
      const stored = db.get(`qrCodes/${res.data.qrCodeId}`)!;
      expect(stored.expiresAt.toDate().toISOString()).toBe(res.data.expiresAt);
    });
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

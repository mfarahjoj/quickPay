import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import {
  attemptDelivery,
  eventsForChange,
  MAX_ATTEMPTS,
  RETRY_DELAYS_SECONDS,
  signPayload,
  validateWebhookUrl,
  verifySignature,
} from "../api/webhooks";
import { encrypt } from "../utils/encryption";

const { Timestamp } = admin.firestore;
const SECRET = "whsec_testsecrettestsecrettestsecret";

describe("webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "charge.succeeded" });
  const now = 1_790_000_000;

  it("verifies what we sign", () => {
    expect(verifySignature(signPayload(SECRET, body, now), body, SECRET, now)).toBe(true);
  });

  it("rejects a tampered body, the wrong secret and a stale timestamp", () => {
    const header = signPayload(SECRET, body, now);
    expect(verifySignature(header, body.replace("succeeded", "canceled"), SECRET, now)).toBe(false);
    expect(verifySignature(header, body, "whsec_other", now)).toBe(false);
    expect(verifySignature(header, body, SECRET, now + 301)).toBe(false);
    expect(verifySignature("t=abc,v1=zz", body, SECRET, now)).toBe(false);
  });
});

describe("validateWebhookUrl", () => {
  it.each([
    "https://shop.example/hooks/zapp",
    "https://api.shop.example:8443/zapp?source=webhook",
  ])("accepts %s", (url) => {
    expect(validateWebhookUrl(url)).toBe(new URL(url).toString());
  });

  it.each([
    "http://shop.example/hook",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://10.0.0.5/hook",
    "https://169.254.169.254/computeMetadata/v1/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://[::1]/hook",
    "https://user:pass@shop.example/hook",
    "https://intranet/hook",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => validateWebhookUrl(url)).toThrow(/url must be/);
  });
});

describe("eventsForChange", () => {
  const charge = (status: string, refundCount = 0) => ({ status, refundCount }) as any;

  it("raises one event per status transition", () => {
    expect(eventsForChange("ch_x", charge("pending"), charge("succeeded"))).toEqual([
      { eventId: "evt_ch_x_succeeded", type: "charge.succeeded" },
    ]);
    expect(eventsForChange("ch_x", charge("pending"), charge("expired"))[0].type).toBe("charge.expired");
    expect(eventsForChange("ch_x", charge("pending"), charge("canceled"))[0].type).toBe("charge.canceled");
  });

  it("raises nothing for creation or unrelated updates", () => {
    expect(eventsForChange("ch_x", undefined, charge("pending"))).toEqual([]);
    expect(eventsForChange("ch_x", charge("succeeded"), charge("succeeded"))).toEqual([]);
    expect(eventsForChange("ch_x", charge("succeeded"), undefined)).toEqual([]);
  });

  it("raises a refund event per new refund, with stable ids", () => {
    expect(eventsForChange("ch_x", charge("succeeded", 1), charge("succeeded", 3))).toEqual([
      { eventId: "evt_ch_x_refund_2", type: "charge.refunded" },
      { eventId: "evt_ch_x_refund_3", type: "charge.refunded" },
    ]);
  });
});

describe("attemptDelivery", () => {
  const DELIVERY = "evt_ch_x_succeeded__we_endpointendpointendpoint";
  const payload = JSON.stringify({ id: "evt_ch_x_succeeded", object: "event", type: "charge.succeeded" });
  let db: FakeDb;
  let restore: () => void;
  let fetchSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalKey;
  });

  beforeEach(() => {
    db = fakeFirestore({
      "webhook_endpoints/we_endpointendpointendpoint": {
        merchantId: "merch-1",
        url: "https://shop.example/hooks/zapp",
        secretEnc: encrypt(SECRET),
        enabled: true,
        createdAt: Timestamp.now(),
      },
      "api_events/evt_ch_x_succeeded": {
        type: "charge.succeeded",
        merchantId: "merch-1",
        chargeId: "ch_x",
        payload,
        createdAt: Timestamp.now(),
      },
      [`webhook_deliveries/${DELIVERY}`]: {
        eventId: "evt_ch_x_succeeded",
        endpointId: "we_endpointendpointendpoint",
        merchantId: "merch-1",
        status: "pending",
        attempts: 0,
        nextAttemptAt: Timestamp.fromMillis(Date.now() - 1000),
        createdAt: Timestamp.now(),
      },
    });
    restore = useFakeFirestore(db);
    fetchSpy = jest.spyOn(global, "fetch" as any);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    restore();
    fetchSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("sends the stored payload, signed, and records delivery", async () => {
    fetchSpy.mockResolvedValue({ status: 200 } as Response);

    await attemptDelivery(DELIVERY);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://shop.example/hooks/zapp");
    expect(init.body).toBe(payload);
    expect(init.redirect).toBe("manual");
    expect(verifySignature(init.headers["Zapp-Signature"], payload, SECRET)).toBe(true);
    expect(db.get(`webhook_deliveries/${DELIVERY}`)).toMatchObject({
      status: "delivered",
      attempts: 1,
      lastStatusCode: 200,
    });
  });

  it("schedules a retry with backoff when the merchant's server fails", async () => {
    fetchSpy.mockResolvedValue({ status: 503 } as Response);
    const before = Date.now();

    await attemptDelivery(DELIVERY);

    const d = db.get(`webhook_deliveries/${DELIVERY}`)!;
    expect(d).toMatchObject({ status: "pending", attempts: 1, lastStatusCode: 503 });
    expect(d.nextAttemptAt.toMillis()).toBeGreaterThanOrEqual(before + RETRY_DELAYS_SECONDS[0] * 1000);
  });

  it("does not send a delivery that is not yet due, or is leased elsewhere", async () => {
    const path = `webhook_deliveries/${DELIVERY}`;
    db.store.set(path, { ...db.get(path), nextAttemptAt: Timestamp.fromMillis(Date.now() + 60_000) });
    await attemptDelivery(DELIVERY);
    db.store.set(path, {
      ...db.get(path),
      nextAttemptAt: Timestamp.fromMillis(Date.now() - 1000),
      leaseUntil: Timestamp.fromMillis(Date.now() + 30_000),
    });
    await attemptDelivery(DELIVERY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("gives up after the last attempt", async () => {
    const path = `webhook_deliveries/${DELIVERY}`;
    db.store.set(path, { ...db.get(path), attempts: MAX_ATTEMPTS - 1 });
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    await attemptDelivery(DELIVERY);

    expect(db.get(path)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, lastError: "ECONNREFUSED" });
  });

  it("cancels deliveries to a removed endpoint without sending", async () => {
    const ep = "webhook_endpoints/we_endpointendpointendpoint";
    db.store.set(ep, { ...db.get(ep), enabled: false });

    await attemptDelivery(DELIVERY);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.get(`webhook_deliveries/${DELIVERY}`)!.status).toBe("canceled");
  });
});

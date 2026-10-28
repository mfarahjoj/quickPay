import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import {
  notifyPaymentReceived,
  notifyUser,
  pushLanguageOf,
  sendPushNotification,
} from "../utils/notifications";

/**
 * WALLET_READINESS_PLAN.md F14: a push, and the copy kept for the customer
 * app's notifications list, are written in `users/{uid}.preferredLanguage`.
 */
describe("notifications in the user's language", () => {
  let restore: (() => void) | undefined;
  let messagingSpy: jest.SpyInstance;
  let sent: admin.messaging.MulticastMessage[];

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  beforeEach(() => {
    sent = [];
    messagingSpy = jest.spyOn(admin, "messaging").mockReturnValue({
      sendEachForMulticast: jest.fn(async (message: admin.messaging.MulticastMessage) => {
        sent.push(message);
        return { successCount: message.tokens.length, failureCount: 0, responses: [] };
      }),
    } as any);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
    jest.restoreAllMocks();
  });

  /** A user with one phone, and `fields` on their profile (null: no profile at all). */
  function useUser(fields: Record<string, unknown> | null): FakeDb {
    const db = fakeFirestore({
      ...(fields ? { "users/u1": { fullName: "Hodan Ali", ...fields } } : {}),
      "users/u1/fcmTokens/t1": { token: "token-1" },
    });
    restore = useFakeFirestore(db);
    return db;
  }

  const listed = (db: FakeDb) =>
    [...db.store.entries()].filter(([path]) => path.startsWith("notifications/")).map(([, doc]) => doc);

  const refund = { key: "refund.received", params: { amount: "USD 3.00" } } as const;

  it.each([
    ["so", "Lacag ayaa laguu celiyay", "Waxaa laguu celiyay USD 3.00."],
    ["ar", "تم الاسترداد", "أُعيد مبلغ USD 3.00 إلى محفظتك."],
    ["en", "Refund Received", "You were refunded USD 3.00"],
  ])("pushes and lists a notification in %s when that is the user's language", async (language, title, body) => {
    const db = useUser({ preferredLanguage: language });

    await notifyUser("u1", "refund_issued", refund, { type: "refund_issued" });

    expect(sent).toHaveLength(1);
    expect(sent[0].tokens).toEqual(["token-1"]);
    expect(sent[0].notification).toEqual({ title, body });
    expect(sent[0].data).toEqual({ type: "refund_issued" });
    expect(listed(db)).toEqual([
      expect.objectContaining({ userId: "u1", type: "refund_issued", title, body, read: false }),
    ]);
  });

  it.each([
    ["no language set", {}],
    ["a language the apps don't have", { preferredLanguage: "fr" }],
    ["a malformed language", { preferredLanguage: 7 }],
    ["no profile at all", null],
  ])("falls back to English for %s", async (_, fields) => {
    const db = useUser(fields);

    await notifyUser("u1", "refund_issued", refund);

    expect(sent[0].notification).toEqual({ title: "Refund Received", body: "You were refunded USD 3.00" });
    expect(listed(db)[0]).toMatchObject({ title: "Refund Received", body: "You were refunded USD 3.00" });
  });

  it("falls back to English when the profile can't be read", async () => {
    jest.spyOn(admin, "firestore").mockImplementation(() => {
      throw new Error("unavailable");
    });
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(pushLanguageOf("u1")).resolves.toBe("en");
  });

  it("sends a push-only message in the user's language without listing it", async () => {
    const db = useUser({ preferredLanguage: "so" });

    await sendPushNotification(
      "u1",
      { key: "payment.request", params: { merchant: "Hooyo Cafe", amount: "USD 4.50" } },
      { type: "payment_request" }
    );

    expect(sent[0].notification).toEqual({
      title: "Codsiga lacag bixinta",
      body: "Hooyo Cafe ayaa kaa codsanaya USD 4.50.",
    });
    expect(listed(db)).toEqual([]);
  });

  it("writes the shared payment helpers in the user's language too", async () => {
    const db = useUser({ preferredLanguage: "ar" });

    await notifyPaymentReceived("u1", 1250, "USD", "cust-9");

    expect(sent[0].notification).toEqual({ title: "تم استلام الدفع", body: "وصلتك دفعة بقيمة USD 12.50." });
    expect(sent[0].data).toEqual({ type: "payment_received", amount: "1250", currency: "USD", customerId: "cust-9" });
    expect(listed(db)[0]).toMatchObject({ type: "payment_received", title: "تم استلام الدفع" });
  });

  it("still lists the notification when the user has no phone to push to", async () => {
    const db = fakeFirestore({ "users/u1": { preferredLanguage: "so" } });
    restore = useFakeFirestore(db);

    await notifyUser("u1", "pin_changed", { key: "security.pin_changed" });

    expect(messagingSpy).not.toHaveBeenCalled();
    expect(listed(db)[0]).toMatchObject({ type: "pin_changed", title: "PIN-kaaga Zapp Pay waa la beddelay" });
  });
});

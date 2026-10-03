import * as admin from "firebase-admin";
import * as bcrypt from "bcrypt";

const test = require("firebase-functions-test")();

jest.mock("../utils/encryption", () => ({
  ...jest.requireActual("../utils/encryption"),
  hashPin: jest.fn().mockResolvedValue("new-hash"),
}));
jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

import { notifyUser } from "../utils/notifications";
import { assertResetCooldownAllows } from "../utils/resetCooldown";

const mockedNotify = notifyUser as jest.MockedFunction<typeof notifyUser>;

const UID = "cust-1";
const DAY = 24 * 60 * 60 * 1000;
const { Timestamp } = admin.firestore;
const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);

/**
 * Firestore stand-in: documents by path, subcollections, equality and range
 * filters, deletes. Enough for resetPin and the cool-down guard.
 */
function fakeDb(seed: Record<string, any>) {
  const store = new Map<string, any>(Object.entries(seed));
  const snap = (path: string) => ({
    exists: store.has(path),
    id: path.split("/").pop(),
    data: () => store.get(path),
    ref: ref(path),
  });
  function ref(path: string): any {
    return {
      id: path.split("/").pop(),
      path,
      get: async () => snap(path),
      update: async (d: any) => store.set(path, { ...store.get(path), ...d }),
      set: async (d: any) => store.set(path, d),
      delete: async () => store.delete(path),
      collection: (col: string) => collection(`${path}/${col}`),
    };
  }
  const match = (value: any, op: string, target: any) => {
    const v = value?.toMillis ? value.toMillis() : value;
    const t = target?.toMillis ? target.toMillis() : target;
    return op === "==" ? v === t : op === ">=" ? v >= t : false;
  };
  function query(prefix: string, filters: Array<[string, string, any]>): any {
    return {
      where: (f: string, op: string, v: any) => query(prefix, [...filters, [f, op, v]]),
      get: async () => {
        const docs = [...store.keys()]
          .filter((p) => p.startsWith(`${prefix}/`) && p.split("/").length === prefix.split("/").length + 1)
          .filter((p) => filters.every(([f, op, v]) => match(store.get(p)?.[f], op, v)))
          .map(snap);
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    };
  }
  function collection(prefix: string): any {
    return {
      doc: (id: string) => ref(`${prefix}/${id}`),
      where: (f: string, op: string, v: any) => query(prefix, [[f, op, v]]),
    };
  }
  // Writes apply only if the callback resolves, as in real Firestore, so a
  // refused reset or a locked-out answer leaves the user doc as it was.
  // One at a time, as Firestore's serializable transactions behave.
  let queue: Promise<unknown> = Promise.resolve();
  function runTransaction(fn: (tx: any) => Promise<any>) {
    const run = queue.then(() => runOne(fn));
    queue = run.catch(() => undefined);
    return run;
  }
  async function runOne(fn: (tx: any) => Promise<any>) {
    const staged: Array<() => Promise<void>> = [];
    const tx = {
      get: (r: any) => r.get(),
      update: (r: any, d: any) => staged.push(() => r.update(d)),
    };
    const result = await fn(tx);
    for (const write of staged) await write();
    return result;
  }
  return { store, collection, runTransaction } as any;
}

describe("PIN reset safety", () => {
  let reset: any;
  let firestoreSpy: jest.SpyInstance | undefined;
  let deviceHash: string;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    reset = test.wrap((await import("../auth/resetPin")).resetPin);
    deviceHash = await bcrypt.hash("device-secret", 4);
  });

  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    firestoreSpy?.mockRestore();
    firestoreSpy = undefined;
  });

  afterAll(() => test.cleanup());

  const useDb = (seed: Record<string, any>) => {
    const db = fakeDb(seed);
    const { Timestamp: RealTimestamp, FieldValue } = admin.firestore;
    firestoreSpy = jest.spyOn(admin, "firestore").mockReturnValue(db);
    Object.assign(admin.firestore, { Timestamp: RealTimestamp, FieldValue });
    return db;
  };

  const phoneAuth = (provider = "phone") => ({
    uid: UID,
    token: {
      firebase: { sign_in_provider: provider },
      auth_time: Math.floor(Date.now() / 1000) - 30,
    },
  });

  const call = (data: Record<string, unknown> = {}, provider = "phone") =>
    reset({ data: { newPin: "482915", ...data }, auth: phoneAuth(provider) });

  const user = (overrides: Record<string, unknown> = {}) => ({
    [`users/${UID}`]: { pinHash: "old-hash", kycStatus: "pending", ...overrides },
  });
  const device = (id: string, age: number) => ({
    [`trustedDevices/${id}`]: { uid: UID, secretHash: deviceHash, createdAt: ago(age) },
  });
  const verifiedId = (idNumber = "SL-99AB1234") => ({
    [`users/${UID}`]: { pinHash: "old-hash", kycStatus: "verified" },
    [`users/${UID}/kyc/latest`]: { idNumber, status: "verified" },
  });
  const onKnownPhone = { deviceId: "dev-old", deviceSecret: "device-secret" };

  describe("on a phone the account has used for a week", () => {
    it("resets with the SMS code alone, then drops every other trusted phone", async () => {
      const db = useDb({ ...user(), ...device("dev-old", 30 * DAY), ...device("dev-other", 30 * DAY) });

      const result = await call(onKnownPhone);

      expect(result.success).toBe(true);
      expect(db.store.get(`users/${UID}`).pinHash).toBe("new-hash");
      expect(db.store.has("trustedDevices/dev-old")).toBe(true);
      expect(db.store.has("trustedDevices/dev-other")).toBe(false);
      expect(mockedNotify).toHaveBeenCalledWith(
        UID, "pin_reset", expect.any(String), expect.any(String), expect.any(Object)
      );
      const until = new Date(result.data.cooldownUntil).getTime();
      expect(until - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
    });
  });

  describe("on any other phone", () => {
    it("does not count a phone trusted only yesterday as known", async () => {
      // Registering a device needs no PIN, so a SIM-swapper's phone can be
      // "trusted" within minutes; it can't be a week old.
      useDb({ ...user(), ...device("dev-old", DAY) });
      await expect(call(onKnownPhone)).rejects.toThrow(/agent or support/);
    });

    it("won't take an ID nobody has reviewed", async () => {
      // An attacker on a swapped SIM can submit KYC with their own ID number
      // and then "know" it. Only an admin-verified ID answers the question.
      useDb({
        ...user({ kycStatus: "submitted" }),
        [`users/${UID}/kyc/latest`]: { idNumber: "ATTACKER1234", status: "submitted" },
      });
      await expect(call({ idLast4: "1234" })).rejects.toThrow(/agent or support/);
    });

    it("asks for the ID when it wasn't given", async () => {
      useDb(verifiedId());
      await expect(call()).rejects.toThrow(/last 4 characters/);
    });

    it("resets when the last four of the verified ID match, however typed", async () => {
      const db = useDb({ ...verifiedId(), ...device("dev-stranger", 30 * DAY) });

      await expect(call({ idLast4: "12-34" })).resolves.toMatchObject({ success: true });
      // A phone we could not vouch for keeps no one else's trust.
      expect(db.store.has("trustedDevices/dev-stranger")).toBe(false);
    });

    it("locks after three wrong answers, even before a right one", async () => {
      const db = useDb(verifiedId());

      await expect(call({ idLast4: "0000" })).rejects.toThrow(/doesn't match/);
      await expect(call({ idLast4: "0001" })).rejects.toThrow(/doesn't match/);
      await expect(call({ idLast4: "0002" })).rejects.toThrow(/Too many wrong answers/);
      await expect(call({ idLast4: "1234" })).rejects.toThrow(/Too many wrong answers/);
      expect(db.store.get(`users/${UID}`).pinHash).toBe("old-hash");
    });

    it("gives a burst of parallel answers three tries, not one each", async () => {
      // The attempt used to be counted after the comparison, so every request
      // in a burst read "not locked" and got a guess of its own.
      const db = useDb(verifiedId());
      const guesses = Array.from({ length: 20 }, (_, i) => String(i).padStart(4, "0"));

      const settled = await Promise.allSettled(guesses.map((idLast4) => call({ idLast4 })));
      const reasons = settled.map((r) =>
        r.status === "rejected" ? (r.reason as any).details?.reason : "reset"
      );

      expect(reasons.filter((r) => r === "reset_id_wrong")).toHaveLength(2);
      expect(reasons.filter((r) => r === "reset_id_locked")).toHaveLength(18);
      expect(db.store.get(`users/${UID}`).resetIdFailedAttempts).toBe(3);
      expect(db.store.get(`users/${UID}`).pinHash).toBe("old-hash");
    });
  });

  it("lets only one of two racing resets through", async () => {
    const db = useDb({ ...user(), ...device("dev-old", 30 * DAY) });
    const settled = await Promise.allSettled([call(onKnownPhone), call(onKnownPhone)]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.store.get(`users/${UID}`).pinResetHistory).toHaveLength(1);
  });

  it("allows one reset a day", async () => {
    useDb({ ...user({ pinResetHistory: [ago(2 * 60 * 60 * 1000)] }), ...device("dev-old", 30 * DAY) });
    await expect(call(onKnownPhone)).rejects.toThrow(/Too many PIN resets/);
  });

  it("allows three resets in thirty days", async () => {
    useDb({
      ...user({ pinResetHistory: [ago(3 * DAY), ago(10 * DAY), ago(20 * DAY)] }),
      ...device("dev-old", 30 * DAY),
    });
    await expect(call(onKnownPhone)).rejects.toThrow(/Too many PIN resets/);
  });

  it("still requires a phone sign-in, not a PIN-login token", async () => {
    useDb({ ...user(), ...device("dev-old", 30 * DAY) });
    await expect(call(onKnownPhone, "custom")).rejects.toThrow(/Recent phone verification/);
  });
});

describe("after a reset, sending money pauses", () => {
  let firestoreSpy: jest.SpyInstance | undefined;

  afterEach(() => {
    firestoreSpy?.mockRestore();
    firestoreSpy = undefined;
  });

  const useDb = (seed: Record<string, any>) => {
    const db = fakeDb(seed);
    const { Timestamp: RealTimestamp, FieldValue } = admin.firestore;
    firestoreSpy = jest.spyOn(admin, "firestore").mockReturnValue(db);
    Object.assign(admin.firestore, { Timestamp: RealTimestamp, FieldValue });
    return db;
  };

  const resetHoursAgo = (hours: number) => ({
    [`users/${UID}`]: { pinResetAt: ago(hours * 60 * 60 * 1000) },
  });

  it("does nothing for an account that never reset", async () => {
    useDb({ [`users/${UID}`]: {} });
    await expect(assertResetCooldownAllows(UID, "other", 100_00)).resolves.toBeUndefined();
  });

  it("stops transfers, cash-outs and payouts for the day", async () => {
    useDb(resetHoursAgo(1));
    await expect(assertResetCooldownAllows(UID, "other", 1)).rejects.toMatchObject({
      details: { reason: "pin_reset_cooldown" },
    });
  });

  it("lets a small shop payment through", async () => {
    useDb(resetHoursAgo(1));
    await expect(assertResetCooldownAllows(UID, "shop_payment", 5_00)).resolves.toBeUndefined();
  });

  it("counts everything sent since the reset against the $20", async () => {
    const reset = ago(60 * 60 * 1000);
    useDb({
      [`users/${UID}`]: { pinResetAt: reset },
      "transactions/t1": { fromUserId: UID, amount: 18_00, createdAt: ago(30 * 60 * 1000) },
      "transactions/t0": { fromUserId: UID, amount: 90_00, createdAt: ago(3 * 60 * 60 * 1000) },
    });
    // The $90 predates the reset and doesn't count; the $18 does.
    await expect(assertResetCooldownAllows(UID, "shop_payment", 2_00)).resolves.toBeUndefined();
    await expect(assertResetCooldownAllows(UID, "shop_payment", 5_00)).rejects.toMatchObject({
      details: { reason: "pin_reset_cooldown" },
    });
  });

  it("lifts after 24 hours", async () => {
    useDb(resetHoursAgo(25));
    await expect(assertResetCooldownAllows(UID, "other", 100_00)).resolves.toBeUndefined();
  });
});

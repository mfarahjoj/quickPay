import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import { AGENT_LOOKUP_LIMITS } from "../users/lookupUser";
import { LOOKUP_LIMITS } from "../users/lookupRecipient";

const test = require("firebase-functions-test")();

const AGENT = "agent-1";
const CUSTOMER_PHONE = "+252630000002";
const FROZEN_PHONE = "+252630000004";

/**
 * An agent finds the customer to top up by phone number, and gets their full
 * name and account back. That is the first step of a top-up; it must not
 * also be a way to walk the phone book.
 */
describe("lookupUserByPhone", () => {
  let lookup: any;
  let lookupRecipient: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    lookup = test.wrap((await import("../users/lookupUser")).lookupUserByPhone);
    lookupRecipient = test.wrap((await import("../users/lookupRecipient")).lookupRecipient);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Agent", phoneNumber: "+252630000001" },
      "users/cust-1": { accountType: "customer", fullName: "Amina Yusuf", phoneNumber: CUSTOMER_PHONE },
      "users/shop-1": { accountType: "merchant", fullName: "Shop", phoneNumber: "+252630000003" },
      "users/frozen-1": {
        accountType: "customer",
        fullName: "Frozen Person",
        phoneNumber: FROZEN_PHONE,
        accountStatus: "frozen",
      },
      "users/frozen-agent": { accountType: "topup_agent", fullName: "Frozen Agent", accountStatus: "frozen" },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const call = (phoneNumber: unknown, uid = AGENT) => lookup({ data: { phoneNumber }, auth: { uid } });

  it("finds a customer for an agent", async () => {
    seed();
    const res = await call(CUSTOMER_PHONE);
    expect(res).toEqual({
      success: true,
      data: { userId: "cust-1", phoneNumber: CUSTOMER_PHONE, fullName: "Amina Yusuf", accountType: "customer" },
    });
  });

  it("reads a frozen account as not found, like an unknown number", async () => {
    seed();
    const frozen = await call(FROZEN_PHONE);
    const unknown = await call("+252639999999");
    expect(frozen).toEqual({ success: false, error: "User not found with this phone number" });
    expect(frozen).toEqual(unknown);
  });

  it("refuses customers, with a code the app can read", async () => {
    seed();
    await expect(call(CUSTOMER_PHONE, "cust-1")).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("refuses a frozen agent", async () => {
    seed();
    await expect(call(CUSTOMER_PHONE, "frozen-agent")).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("refuses what isn't a full phone number, and unauthenticated calls", async () => {
    seed();
    for (const phone of ["", "0630000002", "+25263", "+252 63 000 0002", 252630000002]) {
      await expect(call(phone)).rejects.toMatchObject({ code: "invalid-argument" });
    }
    await expect(lookup({ data: { phoneNumber: CUSTOMER_PHONE } })).rejects.toThrow();
  });

  it(`stops after ${AGENT_LOOKUP_LIMITS.perHour} lookups in an hour, found or not`, async () => {
    const db = seed();
    for (let i = 0; i < AGENT_LOOKUP_LIMITS.perHour; i++) {
      await call(`+25263${String(1_000_000 + i)}`);
    }
    const err = await call(CUSTOMER_PHONE).catch((e: any) => e);
    expect(err.code).toBe("resource-exhausted");
    expect(err.details).toEqual({ reason: "lookup_limit" });

    // Another agent's budget is untouched.
    db.store.set("users/agent-2", { accountType: "agent_merchant", fullName: "Agent 2" });
    expect((await call(CUSTOMER_PHONE, "agent-2")).success).toBe(true);
  });

  it("counts apart from the same person's Send money lookups", async () => {
    seed();
    expect(AGENT_LOOKUP_LIMITS.perHour).toBeGreaterThan(LOOKUP_LIMITS.perHour);
    for (let i = 0; i < LOOKUP_LIMITS.perHour; i++) {
      await lookupRecipient({ data: { phoneNumber: `+25263${String(2_000_000 + i)}` }, auth: { uid: AGENT } });
    }
    // The customer-side budget is spent; the counter still works.
    await expect(
      lookupRecipient({ data: { phoneNumber: CUSTOMER_PHONE }, auth: { uid: AGENT } })
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    expect((await call(CUSTOMER_PHONE)).success).toBe(true);
  });
});

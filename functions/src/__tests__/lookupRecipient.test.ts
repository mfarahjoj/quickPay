import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import { maskPersonName, LOOKUP_LIMITS } from "../users/lookupRecipient";

const test = require("firebase-functions-test")();

const CALLER = "cust-1";
const FRIEND_PHONE = "+252630000002";
const SHOP_PHONE = "+252630000003";
const FROZEN_PHONE = "+252630000004";
const CALLER_PHONE = "+252630000001";

/**
 * A customer's Send money looks the recipient up first. lookupUserByPhone
 * refuses customers, so this is their lookup — and it must not become a
 * phone book: masked names, no status leaks, a per-caller budget.
 */
describe("lookupRecipient", () => {
  let lookup: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    lookup = test.wrap((await import("../users/lookupRecipient")).lookupRecipient);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      [`users/${CALLER}`]: { accountType: "customer", fullName: "Amina Yusuf", phoneNumber: CALLER_PHONE },
      "users/friend-1": { accountType: "customer", fullName: "Ali Hassan Warsame", phoneNumber: FRIEND_PHONE },
      "users/shop-1": { accountType: "merchant", fullName: "Owner Name", phoneNumber: SHOP_PHONE },
      "merchantProfiles/shop-1": { businessName: "Hooyo Restaurant" },
      "users/frozen-1": {
        accountType: "customer",
        fullName: "Frozen Person",
        phoneNumber: FROZEN_PHONE,
        accountStatus: "frozen",
      },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const call = (phoneNumber: string, uid = CALLER) =>
    lookup({ data: { phoneNumber }, auth: { uid } });

  it("lets a customer find a person, showing only first name and initial", async () => {
    seed();
    const res = await call(FRIEND_PHONE);
    expect(res.data).toEqual({
      found: true,
      phoneNumber: FRIEND_PHONE,
      displayName: "Ali W.",
      isBusiness: false,
    });
    expect(JSON.stringify(res)).not.toContain("friend-1");
    expect(JSON.stringify(res)).not.toContain("Hassan");
  });

  it("flags a business and gives its shop name", async () => {
    seed();
    const res = await call(SHOP_PHONE);
    expect(res.data).toMatchObject({ found: true, isBusiness: true, displayName: "Hooyo Restaurant" });
  });

  it("treats a frozen account as not found", async () => {
    seed();
    const res = await call(FROZEN_PHONE);
    expect(res.data).toEqual({ found: false, reason: "not_found" });
  });

  it("says when the number is unknown", async () => {
    seed();
    const res = await call("+252639999999");
    expect(res.data).toEqual({ found: false, reason: "not_found" });
  });

  it("says when the number is the caller's own", async () => {
    seed();
    const res = await call(CALLER_PHONE);
    expect(res.data).toEqual({ found: false, reason: "self" });
  });

  it("refuses a frozen caller", async () => {
    seed({ [`users/${CALLER}`]: { accountType: "customer", accountStatus: "frozen" } });
    await expect(call(FRIEND_PHONE)).rejects.toBeInstanceOf(https.HttpsError);
  });

  it("refuses a malformed number and unauthenticated calls", async () => {
    seed();
    await expect(call("0630000002")).rejects.toThrow(/phone number/);
    await expect(lookup({ data: { phoneNumber: FRIEND_PHONE } })).rejects.toThrow();
  });

  it(`stops after ${LOOKUP_LIMITS.perHour} lookups in an hour, found or not`, async () => {
    const db = seed();
    for (let i = 0; i < LOOKUP_LIMITS.perHour; i++) {
      await call(`+25263${String(1_000_000 + i)}`);
    }
    const err = await call(FRIEND_PHONE).catch((e: any) => e);
    expect(err.code).toBe("resource-exhausted");
    expect(err.details).toEqual({ reason: "lookup_limit" });
    // Another customer's budget is untouched.
    db.store.set("users/cust-2", { accountType: "customer", fullName: "Other" });
    const other = await call(FRIEND_PHONE, "cust-2");
    expect(other.data.found).toBe(true);
  });

  it("masks names", () => {
    expect(maskPersonName("Amina")).toBe("Amina");
    expect(maskPersonName("  amina   yusuf ")).toBe("amina Y.");
    expect(maskPersonName("")).toBe("Zapp Pay user");
    expect(maskPersonName(undefined)).toBe("Zapp Pay user");
  });
});

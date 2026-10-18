import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";
import { LEGAL_VERSIONS } from "../config/legal";

const test = require("firebase-functions-test")();

/** ONBOARDING_SECURITY_REVIEW.md E12: consent is recorded with versions. */
describe("acceptTerms", () => {
  let restore: () => void;
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  afterEach(() => restore?.());
  afterAll(() => test.cleanup());

  const call = async (data: any) =>
    test.wrap((await import("../auth/acceptTerms")).acceptTerms)({ data, auth: { uid: "u1", token: {} } });

  it("records the current versions, time and app, and keeps a history", async () => {
    const db = fakeFirestore({ "users/u1": { fullName: "A" } });
    restore = useFakeFirestore(db);
    await call({ termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, app: "customer", appVersion: "1.0.6" });
    expect(db.get("users/u1")!.consent).toMatchObject({ termsVersion: LEGAL_VERSIONS.terms, app: "customer" });
    expect([...db.store.keys()].filter((k) => k.startsWith("users/u1/consents/"))).toHaveLength(1);
  });

  it("refuses consent to a version that isn't the published one", async () => {
    restore = useFakeFirestore(fakeFirestore({ "users/u1": {} }));
    await expect(call({ termsVersion: "2020-01-01", privacyVersion: LEGAL_VERSIONS.privacy })).rejects.toMatchObject({
      details: { reason: "legal_version_mismatch" },
    });
  });
});

describe("reportDeviceRisk (review E14)", () => {
  let restore: () => void;
  afterEach(() => restore?.());
  const call = async (data: any) =>
    test.wrap((await import("../auth/deviceRisk")).reportDeviceRisk)({ data, auth: { uid: "u1", token: {} } });

  it("flags a rooted or hooked phone without blocking anything", async () => {
    const db = fakeFirestore({ "users/u1": {} });
    restore = useFakeFirestore(db);
    await expect(call({ rooted: true, platform: "android", app: "customer" })).resolves.toMatchObject({ success: true });
    expect(db.get("users/u1")!.deviceRisk).toMatchObject({ rooted: true, flagged: true });
    expect([...db.store.keys()].some((k) => k.startsWith("deviceRiskReports/"))).toBe(true);
  });

  it("records a clean phone as unflagged", async () => {
    const db = fakeFirestore({ "users/u1": {} });
    restore = useFakeFirestore(db);
    await call({ platform: "ios" });
    expect(db.get("users/u1")!.deviceRisk.flagged).toBe(false);
  });
});

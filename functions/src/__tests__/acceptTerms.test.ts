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

import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

/**
 * The back of the ID is optional. Writing `backPhotoUrl: undefined` made
 * Firestore reject the document, so every submission without one failed.
 */
describe("submitKYC", () => {
  let submit: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    submit = test.wrap((await import("../auth/submitKYC")).submitKYC);
  });
  afterEach(() => restore?.());
  afterAll(() => test.cleanup());

  const data = {
    idType: "national_id",
    idNumber: "SL1234567",
    frontPhotoUrl: "https://example.test/front.jpg",
    selfieUrl: "https://example.test/selfie.jpg",
  };

  it("leaves backPhotoUrl out when there is no back photo", async () => {
    const db = fakeFirestore({ "users/u1": { kycStatus: "not_submitted" } });
    restore = useFakeFirestore(db);
    await expect(submit({ data, auth: { uid: "u1" } })).resolves.toMatchObject({ success: true });
    const doc = db.get("users/u1/kyc/latest")!;
    expect(Object.keys(doc)).not.toContain("backPhotoUrl");
    expect(Object.values(doc)).not.toContain(undefined);
  });

  it("keeps the back photo when there is one", async () => {
    const db = fakeFirestore({ "users/u1": { kycStatus: "not_submitted" } });
    restore = useFakeFirestore(db);
    await submit({ data: { ...data, backPhotoUrl: "https://example.test/back.jpg" }, auth: { uid: "u1" } });
    expect(db.get("users/u1/kyc/latest")!.backPhotoUrl).toBe("https://example.test/back.jpg");
  });
});

import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../referral/referralBonus", () => ({
  maybeUnlockReferral: jest.fn().mockResolvedValue(false),
}));

import { notifyUser } from "../utils/notifications";
import { maybeUnlockReferral } from "../referral/referralBonus";

const { Timestamp } = admin.firestore;

/**
 * The merchant / agent application: submitted once from the app, decided once
 * in the console, and approval sets everything up (role, merchant profile,
 * agent info, Zaad receiving number, KYC).
 */
describe("role application", () => {
  let submit: any;
  let review: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    submit = test.wrap((await import("../merchants/roleApplication")).submitRoleApplication);
    review = test.wrap((await import("../admin/reviewRoleRequest")).adminReviewRoleRequest);
  });

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => test.cleanup());

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      "users/u1": {
        fullName: "Hodan Ali",
        phoneNumber: "+252634000001",
        accountType: "customer",
        kycStatus: "pending",
        roleRequestStatus: "pending",
        roleRequestedRole: "agent_merchant",
      },
      "roleRequests/u1_agent_merchant": {
        userId: "u1",
        requestedRole: "agent_merchant",
        status: "pending",
        createdAt: Timestamp.now(),
      },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const form = (extra: Record<string, unknown> = {}) => ({
    requestedRole: "agent_merchant",
    businessName: "Hodan Store",
    businessType: "Grocery",
    businessAddress: "Road 1, near the market",
    area: "Jigjiga Yar",
    location: { lat: 9.5624, lng: 44.077, accuracyM: 12 },
    shopPhotoPath: "kyc/u1/shop_1.jpg",
    payout: { provider: "zaad", number: "063 412 3456" },
    agent: { openHours: "8am–9pm", services: ["cash_in", "cash_out"], zaadReceiveNumber: "0634999888" },
    id: {
      idType: "national_id",
      idNumber: "sl-99ab1234",
      frontPath: "kyc/u1/front_1.jpg",
      backPath: "kyc/u1/back_1.jpg",
      selfiePath: "kyc/u1/selfie_1.jpg",
    },
    ...extra,
  });

  const compliance = {
    uid: "admin-1",
    token: {
      admin: true,
      adminRoles: ["compliance"],
      email: "compliance@zapp.example",
      auth_time: Math.floor(Date.now() / 1000),
    },
  };

  const decide = (decision: "approve" | "reject", extra: Record<string, unknown> = {}) =>
    review({
      data: { requestId: "u1_agent_merchant", decision, reason: "Checked ID and shop in person", ...extra },
      auth: compliance,
    });

  it("stores the full application, the ID as a KYC submission, and marks it submitted", async () => {
    const db = seed();
    await submit({ data: form(), auth: { uid: "u1" } });

    const req = db.get("roleRequests/u1_agent_merchant")!;
    expect(req.status).toBe("pending");
    expect(req.application.payout).toEqual({ provider: "zaad", number: "+252634123456" });
    expect(req.application.agent.zaadReceiveNumber).toBe("+252634999888");
    expect(req.application.location).toEqual({ lat: 9.5624, lng: 44.077, accuracyM: 12 });
    expect(req.application.includesId).toBe(true);

    const kyc = db.get("users/u1/kyc/latest")!;
    expect(kyc.status).toBe("submitted");
    expect(kyc.source).toBe("role_application");
    expect(kyc.frontPhotoPath).toBe("kyc/u1/front_1.jpg");

    const user = db.get("users/u1")!;
    expect(user.kycStatus).toBe("submitted");
    expect(user.roleApplicationSubmittedAt).toBeDefined();
    expect(user.accountType).toBe("customer");
  });

  it("refuses photos outside the applicant's own folder", async () => {
    seed();
    await expect(
      submit({ data: form({ shopPhotoPath: "kyc/someone-else/shop.jpg" }), auth: { uid: "u1" } })
    ).rejects.toThrow(/Shop photo/);
  });

  it("refuses a payout number that isn't a Somali mobile number", async () => {
    seed();
    await expect(
      submit({ data: form({ payout: { provider: "zaad", number: "12345" } }), auth: { uid: "u1" } })
    ).rejects.toThrow(/Payout number/);
  });

  it("skips the ID for an account that is already verified", async () => {
    const db = seed({ "users/u1": { fullName: "Hodan Ali", accountType: "customer", kycStatus: "verified" } });
    await submit({ data: form({ id: undefined }), auth: { uid: "u1" } });
    expect(db.get("roleRequests/u1_agent_merchant")!.application.includesId).toBe(false);
    expect(db.get("users/u1/kyc/latest")).toBeUndefined();
    expect(db.get("users/u1")!.kycStatus).toBe("verified");
  });

  it("approval sets up everything: role, KYC, merchant profile, agent info and Zaad number", async () => {
    const db = seed();
    await submit({ data: form(), auth: { uid: "u1" } });
    await decide("approve");

    const user = db.get("users/u1")!;
    expect(user.accountType).toBe("agent_merchant");
    expect(user.roleRequestStatus).toBe("approved");
    expect(user.kycStatus).toBe("verified");
    expect(user.agentInfo).toMatchObject({
      area: "Jigjiga Yar",
      openHours: "8am–9pm",
      services: ["cash_in", "cash_out"],
      isActive: true,
      businessName: "Hodan Store",
    });

    expect(db.get("users/u1/kyc/latest")!.status).toBe("verified");
    expect(db.get("users/u1/private/identity")!.idNumber).toBe("SL99AB1234");

    expect(db.get("merchantProfiles/u1")).toMatchObject({
      businessName: "Hodan Store",
      businessType: "Grocery",
      businessAddress: "Road 1, near the market",
      settlementPreference: "zaad",
      zaadAccount: "+252634123456",
      minimumSettlementAmount: 1000,
    });

    expect(db.get("zaad_agents/u1")).toMatchObject({
      receiveMsisdn: "+252634999888",
      enabled: true,
      verifiedBy: "admin-1",
      online: false,
    });

    const audit = [...db.store.entries()].find(([p]) => p.startsWith("admin_audit/"))![1];
    expect(audit.after.applied).toEqual({
      kycVerified: true,
      merchantProfile: true,
      agentSetUp: true,
      zaadReceiveNumber: "+252634999888",
    });
    expect(maybeUnlockReferral).toHaveBeenCalledWith("u1", { kind: "kyc_verified" });
    expect(notifyUser).toHaveBeenCalledWith("u1", "role_approved", expect.anything(), expect.anything());
  });

  it("refuses to approve when another agent already receives on that Zaad number", async () => {
    const db = seed({ "zaad_agents/other": { receiveMsisdn: "+252634999888", enabled: true, online: false, openRequestId: null } });
    await submit({ data: form(), auth: { uid: "u1" } });
    await expect(decide("approve")).rejects.toThrow(/Another agent already receives/);
    expect(db.get("users/u1")!.accountType).toBe("customer");
    expect(db.get("roleRequests/u1_agent_merchant")!.status).toBe("pending");
  });

  it("rejection rejects the ID with it, and re-applying starts a fresh form", async () => {
    const db = seed();
    await submit({ data: form(), auth: { uid: "u1" } });
    await decide("reject", { reason: "Shop photo is blurry, please retake" });

    expect(db.get("users/u1")!.kycStatus).toBe("rejected");
    expect(db.get("users/u1/kyc/latest")!.rejectionReason).toBe("Shop photo is blurry, please retake");
    expect(db.get("users/u1")!.accountType).toBe("customer");

    const { ensureRoleRequest } = await import("../merchants/requestRole");
    await ensureRoleRequest(admin.firestore(), "u1", "agent_merchant");
    const req = db.get("roleRequests/u1_agent_merchant")!;
    expect(req.status).toBe("pending");
    expect(req.application).toBeUndefined();
    expect(req.previousApplication.businessName).toBe("Hodan Store");
    expect(db.get("users/u1")!.roleApplicationSubmittedAt).toBeUndefined();
  });

  it("an old-style request with no application approves as before", async () => {
    const db = seed();
    await decide("approve");
    expect(db.get("users/u1")!.accountType).toBe("agent_merchant");
    expect(db.get("zaad_agents/u1")).toBeUndefined();
    expect(db.get("users/u1")!.kycStatus).toBe("pending");
  });
});

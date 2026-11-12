import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";
import { assertNameChangeAllowed } from "../utils/nameLock";

const test = require("firebase-functions-test")();

const MERCHANT = "merch-1";
const AGENT = "agent-1";
const CUSTOMER = "cust-1";

/**
 * A business name is what a customer checks before paying, so merchants and
 * agents can't change it themselves — only ops, with an audit entry.
 */
describe("business name lock", () => {
  let updateProfile: any;
  let setupPin: any;
  let rename: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    updateProfile = test.wrap((await import("../auth/updateProfile")).updateProfile);
    setupPin = test.wrap((await import("../auth/setupPin")).setupPin);
    rename = test.wrap((await import("../admin/renameMerchant")).adminRenameMerchant);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (): FakeDb => {
    const db = fakeFirestore({
      [`users/${MERCHANT}`]: {
        accountType: "merchant",
        fullName: "Hooyo Restaurant",
        pinHash: "$2b$10$abcdefghijklmnopqrstuuvwxyz0123456789ABCDEFGHIJKLMNOP",
      },
      [`merchantProfiles/${MERCHANT}`]: { businessName: "Hooyo Restaurant" },
      [`users/${AGENT}`]: { accountType: "topup_agent", fullName: "Agent Ali" },
      [`users/${CUSTOMER}`]: { accountType: "customer", fullName: "Amina" },
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const adminAuth = (roles = ["ops"]) => ({
    uid: "admin-1",
    token: {
      admin: true,
      adminRoles: roles,
      email: "ops@zapp.example",
      auth_time: Math.floor(Date.now() / 1000),
    },
  });

  describe("assertNameChangeAllowed", () => {
    it("lets customers rename", () => {
      expect(() =>
        assertNameChangeAllowed({ accountType: "customer", fullName: "A" }, "B")
      ).not.toThrow();
    });

    it.each(["merchant", "agent_merchant", "topup_agent"])(
      "stops a %s renaming",
      (accountType) => {
        expect(() =>
          assertNameChangeAllowed({ accountType, fullName: "Old" }, "New")
        ).toThrow(https.HttpsError);
      }
    );

    it("allows re-sending the current name", () => {
      expect(() =>
        assertNameChangeAllowed({ accountType: "merchant", fullName: "Shop" }, " Shop ")
      ).not.toThrow();
    });
  });

  describe("updateProfile", () => {
    it("refuses a merchant rename and leaves the name alone", async () => {
      const db = seed();
      const err = await updateProfile({
        data: { fullName: "Next Door Shop" },
        auth: { uid: MERCHANT },
      }).catch((e: any) => e);
      expect(err.details).toEqual({ reason: "name_locked" });
      expect(db.get(`users/${MERCHANT}`)!.fullName).toBe("Hooyo Restaurant");
    });

    it("still saves a merchant's other fields", async () => {
      const db = seed();
      await updateProfile({ data: { preferredLanguage: "so" }, auth: { uid: MERCHANT } });
      expect(db.get(`users/${MERCHANT}`)!.preferredLanguage).toBe("so");
    });

    it("lets a customer rename", async () => {
      const db = seed();
      await updateProfile({ data: { fullName: "Amina Yusuf" }, auth: { uid: CUSTOMER } });
      expect(db.get(`users/${CUSTOMER}`)!.fullName).toBe("Amina Yusuf");
    });
  });

  describe("setupPin", () => {
    it("can't be re-run to rename a merchant", async () => {
      const db = seed();
      const err = await setupPin({
        data: { fullName: "Next Door Shop", accountType: "merchant" },
        auth: { uid: MERCHANT, token: { phone_number: "+252630000001" } },
      }).catch((e: any) => e);
      expect(err.details).toEqual({ reason: "name_locked" });
      expect(db.get(`users/${MERCHANT}`)!.fullName).toBe("Hooyo Restaurant");
    });
  });

  describe("adminRenameMerchant", () => {
    const call = (data: Record<string, unknown>, auth: any = adminAuth()) =>
      rename({ data: { userId: MERCHANT, name: "Hooyo Grill", reason: "Shop rebranded, papers seen", ...data }, auth });

    it("renames both name fields and records who did it", async () => {
      const db = seed();
      const res = await call({});
      expect(res.data.previousName).toBe("Hooyo Restaurant");
      expect(db.get(`users/${MERCHANT}`)!.fullName).toBe("Hooyo Grill");
      expect(db.get(`merchantProfiles/${MERCHANT}`)!.businessName).toBe("Hooyo Grill");
      const audit = db.get(`admin_audit/${res.data.auditId}`)!;
      expect(audit.action).toBe("merchant.rename");
      expect(audit.before).toEqual({ name: "Hooyo Restaurant" });
      expect(audit.after).toEqual({ name: "Hooyo Grill" });
    });

    it("renames an agent with no shop profile", async () => {
      const db = seed();
      await call({ userId: AGENT, name: "Agent Ali Yusuf" });
      expect(db.get(`users/${AGENT}`)!.fullName).toBe("Agent Ali Yusuf");
      expect(db.get(`merchantProfiles/${AGENT}`)).toBeUndefined();
    });

    it("refuses non-admins", async () => {
      seed();
      await expect(call({}, { uid: MERCHANT, token: {} })).rejects.toThrow(/not authorized/i);
    });

    it("refuses a customer account", async () => {
      seed();
      await expect(call({ userId: CUSTOMER })).rejects.toThrow(/customers rename themselves/);
    });

    it("needs a reason", async () => {
      seed();
      await expect(call({ reason: "" })).rejects.toThrow();
    });
  });
});

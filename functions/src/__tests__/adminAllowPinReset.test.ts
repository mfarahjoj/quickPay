import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));
import { notifyUser } from "../utils/notifications";

const UID = "cust-1";
const HASH = "$2b$10$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvwxyz01234";

const adminAuth = (roles: string[] = ["ops"]) => ({
  uid: "admin-1",
  token: {
    admin: true,
    adminRoles: roles,
    email: "ops@zapp.example",
    auth_time: Math.floor(Date.now() / 1000),
  },
});

describe("adminAllowPinReset", () => {
  let allow: any;
  let db: FakeDb;
  let restore: () => void;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    allow = test.wrap((await import("../admin/lookupUser")).adminAllowPinReset);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    db = fakeFirestore({
      [`users/${UID}`]: { accountType: "customer", accountStatus: "active", hasPin: true },
      [`users/${UID}/private/auth`]: { pinHash: HASH, resetIdFailedAttempts: 3 },
    });
    restore = useFakeFirestore(db);
  });

  afterEach(() => restore());
  afterAll(() => test.cleanup());

  const run = (data: Record<string, unknown> = {}, auth: any = adminAuth()) =>
    allow({ data: { userId: UID, reason: "Checked passport at the Hargeisa desk", idChecked: true, ...data }, auth });

  it("opens a 30-minute grant, audits it and tells the customer", async () => {
    const res = await run();
    const grant = db.get(`users/${UID}/private/auth`)!.staffResetGrant;
    expect(grant).toMatchObject({ grantedBy: "admin-1", auditId: res.data.auditId });
    const minutes = (grant.expiresAt.toMillis() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    expect(db.get(`users/${UID}/private/auth`)!.resetIdFailedAttempts).toBe(0);

    const audit = [...db.store.entries()].find(([p]) => p.startsWith("admin_audit/"))![1];
    expect(audit).toMatchObject({ action: "user.allowPinReset", target: { type: "user", id: UID } });
    expect(notifyUser).toHaveBeenCalledWith(UID, "pin_reset", expect.any(String), expect.any(String), expect.any(Object));
  });

  it("refuses unless staff confirm they checked the ID", async () => {
    await expect(run({ idChecked: false })).rejects.toThrow(/Check the person's ID/);
    expect(db.get(`users/${UID}/private/auth`)!.staffResetGrant).toBeUndefined();
  });

  it("is for ops only", async () => {
    await expect(run({}, adminAuth(["compliance"]))).rejects.toThrow();
  });

  it("needs a reason", async () => {
    await expect(run({ reason: "x" })).rejects.toThrow();
  });

  it("refuses an account with no PIN", async () => {
    db.store.set(`users/${UID}/private/auth`, {});
    await expect(run()).rejects.toThrow(/no PIN yet/);
  });
});

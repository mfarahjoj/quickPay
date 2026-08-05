import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Callable-level guards on the role approval gate.
 *
 * These cover the paths that reject before touching Firestore. The full
 * approve/demote behaviour needs the emulator suite (blocked on Java in this
 * environment), so it is verified by construction and typecheck rather than
 * end-to-end here.
 */
describe("requestRole", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../merchants/requestRole");
    wrapped = test.wrap(mod.requestRole);
  });

  afterAll(() => test.cleanup());

  it("rejects unauthenticated callers", async () => {
    await expect(
      wrapped({ data: { requestedRole: "merchant" } })
    ).rejects.toThrow();
  });

  it("rejects a role that is not a real privileged role", async () => {
    await expect(
      wrapped({ data: { requestedRole: "admin" }, auth: { uid: "u1" } })
    ).rejects.toThrow(/merchant, topup_agent or agent_merchant/i);
  });

  it("rejects customer as a requested role", async () => {
    // "customer" is the default, not something to apply for.
    await expect(
      wrapped({ data: { requestedRole: "customer" }, auth: { uid: "u1" } })
    ).rejects.toThrow(/merchant, topup_agent or agent_merchant/i);
  });

  it("rejects a missing role", async () => {
    await expect(
      wrapped({ data: {}, auth: { uid: "u1" } })
    ).rejects.toThrow(/requestedRole/i);
  });
});

describe("adminReviewRoleRequest", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../admin/reviewRoleRequest");
    wrapped = test.wrap(mod.adminReviewRoleRequest);
  });

  afterAll(() => test.cleanup());

  const freshAuth = (claims: Record<string, unknown>) => ({
    uid: "admin-1",
    token: {
      email: "compliance@zapp.example",
      auth_time: Math.floor(Date.now() / 1000) - 30,
      ...claims,
    },
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      wrapped({ data: { requestId: "u1_merchant", decision: "approve", reason: "looks fine" } })
    ).rejects.toThrow();
  });

  it("rejects a signed-in non-admin", async () => {
    await expect(
      wrapped({
        data: { requestId: "u1_merchant", decision: "approve", reason: "looks fine" },
        auth: { uid: "u1", token: { email: "user@example.com" } },
      })
    ).rejects.toThrow(/not authorized/i);
  });

  it("rejects an admin without the compliance role", async () => {
    await expect(
      wrapped({
        data: { requestId: "u1_merchant", decision: "approve", reason: "looks fine" },
        auth: freshAuth({ admin: true, adminRoles: ["ops"] }),
      })
    ).rejects.toThrow(/not authorized/i);
  });

  it("rejects a stale admin session", async () => {
    await expect(
      wrapped({
        data: { requestId: "u1_merchant", decision: "approve", reason: "looks fine" },
        auth: {
          uid: "admin-1",
          token: {
            email: "compliance@zapp.example",
            admin: true,
            adminRoles: ["compliance"],
            auth_time: Math.floor(Date.now() / 1000) - 7200,
          },
        },
      })
    ).rejects.toThrow(/recent sign-in/i);
  });

  it("requires a reason", async () => {
    await expect(
      wrapped({
        data: { requestId: "u1_merchant", decision: "approve", reason: "ok" },
        auth: freshAuth({ admin: true, adminRoles: ["compliance"] }),
      })
    ).rejects.toThrow(/reason/i);
  });

  it("rejects an unknown decision", async () => {
    await expect(
      wrapped({
        data: {
          requestId: "u1_merchant",
          decision: "maybe",
          reason: "undecided for now",
        },
        auth: freshAuth({ admin: true, adminRoles: ["compliance"] }),
      })
    ).rejects.toThrow(/approve.*reject/i);
  });

  it("requires a requestId", async () => {
    await expect(
      wrapped({
        data: { decision: "approve", reason: "looks legitimate" },
        auth: freshAuth({ admin: true, adminRoles: ["compliance"] }),
      })
    ).rejects.toThrow(/requestId/i);
  });

  // Note: there is deliberately no "super admin succeeds" case here. Once
  // authorization passes, the callable reaches Firestore, which hangs without
  // the emulator. That super satisfies every role requirement is asserted
  // directly against requireAdmin in adminGuard.test.ts.
});

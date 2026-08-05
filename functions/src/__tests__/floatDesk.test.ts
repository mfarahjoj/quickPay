import * as admin from "firebase-admin";

const test = require("firebase-functions-test")();

jest.mock("../utils/notifications", () => ({
  notifyUser: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Guard coverage for the float desk.
 *
 * Everything here rejects before Firestore is touched. The posting path and
 * maker-checker enforcement need the emulator suite (blocked on Java in this
 * environment); the ledger template itself is covered by floatAccounts.test.ts
 * and ledgerFrozen.test.ts.
 */
const freshAuth = (roles: string[], uid = "admin-1") => ({
  uid,
  token: {
    email: "ops@zapp.example",
    admin: true,
    adminRoles: roles,
    auth_time: Math.floor(Date.now() / 1000) - 30,
  },
});

const validRequest = {
  agentId: "agent-1",
  direction: "issue",
  amountCents: 25000,
  route: "cash",
  reason: "agent paid cash at the office",
};

describe("adminRequestFloat", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../admin/floatDesk");
    wrapped = test.wrap(mod.adminRequestFloat);
  });

  afterAll(() => test.cleanup());

  it("rejects unauthenticated callers", async () => {
    await expect(wrapped({ data: validRequest })).rejects.toThrow();
  });

  it("rejects a signed-in non-admin", async () => {
    await expect(
      wrapped({ data: validRequest, auth: { uid: "u1", token: {} } })
    ).rejects.toThrow(/not authorized/i);
  });

  it("rejects a compliance-only admin", async () => {
    // Reviewing KYC and role applications does not make you the float desk.
    await expect(
      wrapped({ data: validRequest, auth: freshAuth(["compliance"]) })
    ).rejects.toThrow(/not authorized/i);
  });

  it("rejects a stale admin session", async () => {
    await expect(
      wrapped({
        data: validRequest,
        auth: {
          uid: "admin-1",
          token: {
            email: "ops@zapp.example",
            admin: true,
            adminRoles: ["ops"],
            auth_time: Math.floor(Date.now() / 1000) - 7200,
          },
        },
      })
    ).rejects.toThrow(/recent sign-in/i);
  });

  it("requires a reason", async () => {
    await expect(
      wrapped({
        data: { ...validRequest, reason: "cash" },
        auth: freshAuth(["ops"]),
      })
    ).rejects.toThrow(/reason/i);
  });

  it("rejects an unknown direction", async () => {
    await expect(
      wrapped({
        data: { ...validRequest, direction: "transfer" },
        auth: freshAuth(["ops"]),
      })
    ).rejects.toThrow(/issue.*withdraw/i);
  });

  it("rejects non-integer, zero and negative amounts", async () => {
    for (const amountCents of [0, -100, 12.5, NaN]) {
      await expect(
        wrapped({ data: { ...validRequest, amountCents }, auth: freshAuth(["ops"]) })
      ).rejects.toThrow(/positive integer/i);
    }
  });

  it("caps a single movement", async () => {
    // A fat-fingered extra zero should not become a six-figure entry.
    await expect(
      wrapped({
        data: { ...validRequest, amountCents: 100_000_01 },
        auth: freshAuth(["ops"]),
      })
    ).rejects.toThrow(/capped/i);
  });

  it("rejects an unknown funding route", async () => {
    await expect(
      wrapped({
        data: { ...validRequest, route: "cheque" },
        auth: freshAuth(["ops"]),
      })
    ).rejects.toThrow(/cash, zaad, edahab or bank/i);
  });

  it("requires an external reference for non-cash routes", async () => {
    // Without it there is nothing to reconcile the entry against.
    for (const route of ["zaad", "edahab", "bank"]) {
      await expect(
        wrapped({ data: { ...validRequest, route }, auth: freshAuth(["ops"]) })
      ).rejects.toThrow(/external reference/i);
    }
  });

  it("rejects a blank agentId", async () => {
    await expect(
      wrapped({ data: { ...validRequest, agentId: "  " }, auth: freshAuth(["ops"]) })
    ).rejects.toThrow(/agentId/i);
  });
});

describe("adminApproveFloat", () => {
  let wrapped: any;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    const mod = await import("../admin/floatDesk");
    wrapped = test.wrap(mod.adminApproveFloat);
  });

  afterAll(() => test.cleanup());

  const payload = { issuanceId: "iss-1", reason: "verified the deposit slip" };

  it("rejects unauthenticated callers", async () => {
    await expect(wrapped({ data: payload })).rejects.toThrow();
  });

  it("rejects a compliance-only admin", async () => {
    await expect(
      wrapped({ data: payload, auth: freshAuth(["compliance"]) })
    ).rejects.toThrow(/not authorized/i);
  });

  it("rejects a stale session", async () => {
    await expect(
      wrapped({
        data: payload,
        auth: {
          uid: "admin-1",
          token: {
            email: "ops@zapp.example",
            admin: true,
            adminRoles: ["ops"],
            auth_time: Math.floor(Date.now() / 1000) - 7200,
          },
        },
      })
    ).rejects.toThrow(/recent sign-in/i);
  });

  it("requires a reason", async () => {
    await expect(
      wrapped({
        data: { ...payload, reason: "ok" },
        auth: freshAuth(["ops"]),
      })
    ).rejects.toThrow(/reason/i);
  });

  it("requires an issuanceId", async () => {
    await expect(
      wrapped({ data: { reason: "verified the deposit slip" }, auth: freshAuth(["ops"]) })
    ).rejects.toThrow(/issuanceId/i);
  });
});

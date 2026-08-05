import { https } from "firebase-functions/v2";
import {
  requireAdmin,
  requireRecentAdminAuth,
  requireReason,
} from "../admin/guard";

function req(auth?: Record<string, unknown>): https.CallableRequest {
  return { data: {}, auth } as unknown as https.CallableRequest;
}

function adminAuth(
  claims: Record<string, unknown>,
  uid = "admin-1"
): Record<string, unknown> {
  return { uid, token: { email: "ops@zapp.example", ...claims } };
}

describe("requireAdmin", () => {
  it("rejects unauthenticated callers", () => {
    expect(() => requireAdmin(req())).toThrow(/authentication/i);
  });

  it("rejects an ordinary signed-in user", () => {
    expect(() => requireAdmin(req(adminAuth({})))).toThrow(/not authorized/i);
  });

  it("rejects the admin flag without any role", () => {
    expect(() => requireAdmin(req(adminAuth({ admin: true })))).toThrow(
      /not authorized/i
    );
    expect(() =>
      requireAdmin(req(adminAuth({ admin: true, adminRoles: [] })))
    ).toThrow(/not authorized/i);
  });

  // A forged claim would have to be signed by Google to reach us, but a
  // truthy-but-not-true value must not slip through a loose comparison.
  it("requires admin to be exactly true", () => {
    expect(() =>
      requireAdmin(req(adminAuth({ admin: "true", adminRoles: ["ops"] })))
    ).toThrow(/not authorized/i);
    expect(() =>
      requireAdmin(req(adminAuth({ admin: 1, adminRoles: ["ops"] })))
    ).toThrow(/not authorized/i);
  });

  it("discards role values that are not real roles", () => {
    expect(() =>
      requireAdmin(req(adminAuth({ admin: true, adminRoles: ["root", "owner"] })))
    ).toThrow(/not authorized/i);
  });

  it("returns the identity for a valid admin", () => {
    const identity = requireAdmin(
      req(adminAuth({ admin: true, adminRoles: ["ops"] }))
    );
    expect(identity).toEqual({
      uid: "admin-1",
      email: "ops@zapp.example",
      roles: ["ops"],
    });
  });

  it("enforces the required role", () => {
    const opsOnly = req(adminAuth({ admin: true, adminRoles: ["ops"] }));
    expect(() => requireAdmin(opsOnly, "compliance")).toThrow(/not authorized/i);
    expect(() => requireAdmin(opsOnly, "ops")).not.toThrow();
    expect(() => requireAdmin(opsOnly, ["ops", "compliance"])).not.toThrow();
  });

  it("lets super satisfy every role requirement", () => {
    const superAdmin = req(adminAuth({ admin: true, adminRoles: ["super"] }));
    expect(() => requireAdmin(superAdmin, "compliance")).not.toThrow();
    expect(() => requireAdmin(superAdmin, "ops")).not.toThrow();
  });

  it("accepts multiple held roles", () => {
    const both = req(adminAuth({ admin: true, adminRoles: ["ops", "compliance"] }));
    expect(requireAdmin(both).roles).toEqual(["ops", "compliance"]);
    expect(() => requireAdmin(both, "compliance")).not.toThrow();
  });
});

describe("requireRecentAdminAuth", () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it("accepts a fresh sign-in", () => {
    expect(() =>
      requireRecentAdminAuth(
        req({ uid: "a", token: { auth_time: nowSeconds() - 60 } })
      )
    ).not.toThrow();
  });

  it("rejects a stale session", () => {
    expect(() =>
      requireRecentAdminAuth(
        req({ uid: "a", token: { auth_time: nowSeconds() - 3600 } })
      )
    ).toThrow(/recent sign-in/i);
  });

  it("rejects a token with no auth_time", () => {
    expect(() => requireRecentAdminAuth(req({ uid: "a", token: {} }))).toThrow(
      /recent sign-in/i
    );
  });
});

describe("requireReason", () => {
  it("requires a substantive reason", () => {
    expect(() => requireReason(undefined)).toThrow(/reason/i);
    expect(() => requireReason("")).toThrow(/reason/i);
    expect(() => requireReason("fraud")).toThrow(/reason/i);
    expect(() => requireReason("       ")).toThrow(/reason/i);
  });

  it("trims and returns a valid reason", () => {
    expect(requireReason("  suspected agent collusion  ")).toBe(
      "suspected agent collusion"
    );
  });

  it("caps runaway input", () => {
    expect(requireReason("x".repeat(2000))).toHaveLength(500);
  });
});

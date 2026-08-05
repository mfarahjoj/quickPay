import {
  resolveAccountStatus,
  isAccountActive,
  assertAccountActive,
} from "../utils/accountStatus";

describe("resolveAccountStatus", () => {
  it("reads an explicit status", () => {
    expect(resolveAccountStatus({ accountStatus: "frozen" })).toBe("frozen");
    expect(resolveAccountStatus({ accountStatus: "active" })).toBe("active");
    expect(resolveAccountStatus({ accountStatus: "closed" })).toBe("closed");
  });

  // The critical backward-compatibility case: every account that existed
  // before the admin console has no accountStatus field. If a missing field
  // read as anything but active, deploying this would lock out the entire
  // user base.
  it("treats a missing status as active", () => {
    expect(resolveAccountStatus({})).toBe("active");
    expect(resolveAccountStatus(undefined)).toBe("active");
    expect(resolveAccountStatus({ isActive: true })).toBe("active");
  });

  it("keeps the legacy isActive:false meaning closed", () => {
    expect(resolveAccountStatus({ isActive: false })).toBe("closed");
  });

  it("prefers an explicit status over legacy isActive", () => {
    expect(resolveAccountStatus({ accountStatus: "active", isActive: false })).toBe(
      "active"
    );
    expect(resolveAccountStatus({ accountStatus: "frozen", isActive: true })).toBe(
      "frozen"
    );
  });

  it("ignores an unrecognised status rather than failing open or shut", () => {
    // Garbage falls back to the legacy signal, not to "frozen" (which would
    // lock people out on a typo) and not blindly to "active".
    expect(resolveAccountStatus({ accountStatus: "banana" })).toBe("active");
    expect(resolveAccountStatus({ accountStatus: "banana", isActive: false })).toBe(
      "closed"
    );
  });
});

describe("isAccountActive", () => {
  it("is true only for active accounts", () => {
    expect(isAccountActive({ accountStatus: "active" })).toBe(true);
    expect(isAccountActive({})).toBe(true);
    expect(isAccountActive({ accountStatus: "frozen" })).toBe(false);
    expect(isAccountActive({ accountStatus: "closed" })).toBe(false);
    expect(isAccountActive({ isActive: false })).toBe(false);
  });
});

describe("assertAccountActive", () => {
  it("passes an active account", () => {
    expect(() => assertAccountActive({ accountStatus: "active" })).not.toThrow();
    expect(() => assertAccountActive({})).not.toThrow();
  });

  it("rejects a frozen actor with permission-denied", () => {
    expect(() => assertAccountActive({ accountStatus: "frozen" })).toThrow(
      /frozen/i
    );
  });

  it("rejects a closed actor", () => {
    expect(() => assertAccountActive({ accountStatus: "closed" })).toThrow(
      /closed/i
    );
  });

  it("does not leak a counterparty's status to the caller", () => {
    // A customer paying a frozen merchant must not learn why it failed.
    let message = "";
    try {
      assertAccountActive({ accountStatus: "frozen" }, "counterparty");
    } catch (e: any) {
      message = e.message;
    }
    expect(message).not.toMatch(/frozen/i);
    expect(message).toMatch(/unavailable/i);
  });
});

import {
  PRIVILEGED_ROLES,
  isPrivilegedRole,
  isAgentRole,
  isMerchantRole,
  canLookupUsers,
} from "../utils/roles";

describe("isPrivilegedRole", () => {
  it("accepts every role that requires admin approval", () => {
    for (const role of PRIVILEGED_ROLES) {
      expect(isPrivilegedRole(role)).toBe(true);
    }
  });

  it("rejects customer and junk", () => {
    expect(isPrivilegedRole("customer")).toBe(false);
    expect(isPrivilegedRole("admin")).toBe(false);
    expect(isPrivilegedRole("")).toBe(false);
    expect(isPrivilegedRole(undefined)).toBe(false);
    expect(isPrivilegedRole(null)).toBe(false);
    expect(isPrivilegedRole(true)).toBe(false);
    expect(isPrivilegedRole({ role: "merchant" })).toBe(false);
  });
});

describe("isAgentRole", () => {
  it("covers both roles that handle cash", () => {
    expect(isAgentRole("topup_agent")).toBe(true);
    expect(isAgentRole("agent_merchant")).toBe(true);
  });

  it("excludes plain merchants and customers", () => {
    expect(isAgentRole("merchant")).toBe(false);
    expect(isAgentRole("customer")).toBe(false);
    expect(isAgentRole(undefined)).toBe(false);
  });
});

describe("isMerchantRole", () => {
  it("covers both roles that accept payments", () => {
    expect(isMerchantRole("merchant")).toBe(true);
    expect(isMerchantRole("agent_merchant")).toBe(true);
  });

  it("excludes top-up-only agents and customers", () => {
    expect(isMerchantRole("topup_agent")).toBe(false);
    expect(isMerchantRole("customer")).toBe(false);
    expect(isMerchantRole(undefined)).toBe(false);
  });
});

describe("canLookupUsers", () => {
  // The regression this helper exists for: lookupUserByPhone allowed
  // topup_agent and merchant but not agent_merchant, so agent-merchants were
  // denied at the first step of the agent top-up flow.
  it("allows agent_merchant", () => {
    expect(canLookupUsers("agent_merchant")).toBe(true);
  });

  it("allows every privileged role", () => {
    expect(canLookupUsers("topup_agent")).toBe(true);
    expect(canLookupUsers("merchant")).toBe(true);
    expect(canLookupUsers("agent_merchant")).toBe(true);
  });

  it("denies customers", () => {
    expect(canLookupUsers("customer")).toBe(false);
    expect(canLookupUsers(undefined)).toBe(false);
  });
});

import {
  floatAccountForRoute,
  isFloatRoute,
  FLOAT_ROUTES,
  FLOAT_AGENTS,
  FLOAT_BANK,
  FLOAT_ZAAD,
  FLOAT_EDAHAB,
  isValidAccount,
  type FloatRoute,
} from "../ledger/accounts";
import { DEFAULT_RATES } from "../config/rates";

/**
 * The float desk exists because the retired seed-agent-float.js always booked
 * value to float:agents no matter how the agent paid, which made the books
 * unreconcilable against a real bank or Zaad statement. These assertions pin
 * the mapping that fixes it.
 */
describe("floatAccountForRoute", () => {
  it("books each route to the account the value actually landed in", () => {
    expect(floatAccountForRoute("cash")).toBe(FLOAT_AGENTS);
    expect(floatAccountForRoute("zaad")).toBe(FLOAT_ZAAD);
    expect(floatAccountForRoute("edahab")).toBe(FLOAT_EDAHAB);
    expect(floatAccountForRoute("bank")).toBe(FLOAT_BANK);
  });

  it("never maps two routes to the same account", () => {
    const accounts = FLOAT_ROUTES.map(floatAccountForRoute);
    expect(new Set(accounts).size).toBe(FLOAT_ROUTES.length);
  });

  it("produces valid chart-of-accounts ids for every route", () => {
    for (const route of FLOAT_ROUTES) {
      expect(isValidAccount(floatAccountForRoute(route))).toBe(true);
    }
  });

  it("covers every declared route", () => {
    // A route added to the union without a case here would return undefined
    // and post an entry against a bogus account.
    for (const route of FLOAT_ROUTES) {
      expect(typeof floatAccountForRoute(route)).toBe("string");
    }
  });
});

describe("isFloatRoute", () => {
  it("accepts the four real routes", () => {
    for (const route of FLOAT_ROUTES) {
      expect(isFloatRoute(route)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isFloatRoute("cheque")).toBe(false);
    expect(isFloatRoute("")).toBe(false);
    expect(isFloatRoute(undefined)).toBe(false);
    expect(isFloatRoute(null)).toBe(false);
    expect(isFloatRoute(0)).toBe(false);
    expect(isFloatRoute(["cash"] as unknown as FloatRoute)).toBe(false);
  });
});

describe("float approval threshold", () => {
  it("defaults to $500 in whole cents", () => {
    expect(DEFAULT_RATES.floatApprovalThresholdCents).toBe(50000);
    expect(Number.isInteger(DEFAULT_RATES.floatApprovalThresholdCents)).toBe(true);
  });
});

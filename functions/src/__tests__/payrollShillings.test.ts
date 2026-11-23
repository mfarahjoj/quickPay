import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";

const test = require("firebase-functions-test")();

jest.mock("../auth/validatePin", () => ({ verifyUserPin: jest.fn() }));
jest.mock("../utils/notifications", () => ({ notifyPaymentReceived: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/limits", () => ({
  enforcePerTransactionLimit: jest.fn().mockResolvedValue(undefined),
  enforceAggregateLimits: jest.fn().mockResolvedValue(undefined),
}));

import { verifyUserPin } from "../auth/validatePin";
import { enforceAggregateLimits, enforcePerTransactionLimit } from "../utils/limits";

const mockedPin = verifyUserPin as jest.MockedFunction<typeof verifyUserPin>;

const SHOP = "shop-1";
const pocket = (balance: number) => ({ balance, totalSent: 0, totalReceived: 0 });

/**
 * Payroll in shillings (SHILLINGS.md): a run is in one currency, paid from
 * the shop's balance in it and received in it, never converted.
 */
describe("payroll in shillings", () => {
  let payroll: any;
  let restore: (() => void) | undefined;

  beforeAll(async () => {
    if (!admin.apps.length) admin.initializeApp();
    payroll = test.wrap((await import("../wallet/payrollPayout")).payrollPayout);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPin.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  afterAll(() => test.cleanup());

  const seed = (shopWallet = wallet(5_000, { sls: pocket(900_000) })): FakeDb => {
    const db = fakeFirestore({
      [`users/${SHOP}`]: { accountType: "merchant", fullName: "Hodan's Shop", kycStatus: "verified" },
      [`wallets/${SHOP}`]: shopWallet,
      "users/emp-1": { accountType: "customer", fullName: "Abdi", phoneNumber: "+252634000001" },
      "users/emp-2": { accountType: "customer", fullName: "Sahra", phoneNumber: "+252634000002" },
      "wallets/emp-1": wallet(0),
      "wallets/emp-2": wallet(0),
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const run = (currency: string, amounts: [number, number]) =>
    payroll({
      data: {
        currency,
        pin: "123456",
        employees: [
          { phone: "+252634000001", name: "Abdi", amount: amounts[0] },
          { phone: "+252634000002", name: "Sahra", amount: amounts[1] },
        ],
      },
      auth: { uid: SHOP },
    });

  it("pays each employee in shillings from the shop's shillings", async () => {
    const db = seed();
    const res = await run("SLS", [300_000, 200_000]);
    expect(res.data).toMatchObject({ totalPaid: 500_000, successCount: 2, failedCount: 0 });
    expect(db.get(`wallets/${SHOP}`)!.sls.balance).toBe(400_000);
    expect(db.get(`wallets/${SHOP}`)!.balance).toBe(5_000);
    expect(db.get("wallets/emp-1")!.sls.balance).toBe(300_000);
    expect(db.get("wallets/emp-2")!.sls.balance).toBe(200_000);
    expect(enforcePerTransactionLimit).toHaveBeenCalledWith(300_000, expect.anything(), "SLS");
    expect(enforceAggregateLimits).toHaveBeenCalledWith(SHOP, 500_000, expect.anything(), undefined, "SLS");
  });

  it("checks the shilling balance, not the dollar one", async () => {
    seed(wallet(10_000_000));
    await expect(run("SLS", [300_000, 200_000])).rejects.toThrow(/Insufficient balance/);
  });

  it("still pays dollars as before", async () => {
    const db = seed();
    await run("USD", [2_000, 1_000]);
    expect(db.get(`wallets/${SHOP}`)!.balance).toBe(2_000);
    expect(db.get("wallets/emp-1")!.balance).toBe(2_000);
    expect(db.get(`wallets/${SHOP}`)!.sls.balance).toBe(900_000);
  });

  it("refuses a currency Zapp doesn't hold", async () => {
    seed();
    await expect(run("KES", [1, 1])).rejects.toThrow(/USD or SLS/);
  });
});

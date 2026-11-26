import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet } from "./helpers/fakeFirestore";
import { expectWireSafe } from "./helpers/wireSafe";

const test = require("firebase-functions-test")();

describe("getBalance response", () => {
  let restore: () => void;
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });
  afterEach(() => restore?.());
  afterAll(() => test.cleanup());

  const call = async () =>
    test.wrap((await import("../wallet/getBalance")).getBalance)({ data: {}, auth: { uid: "u1", token: {} } });

  it("sends lastTransactionAt as an ISO string", async () => {
    const at = admin.firestore.Timestamp.fromMillis(Date.UTC(2026, 10, 21, 9, 30));
    restore = useFakeFirestore(
      fakeFirestore({
        "users/u1": { accountType: "merchant" },
        "wallets/u1": wallet(1500, { lastTransactionAt: at }),
      })
    );
    const res = await call();
    // A Date here reached the app as {}, and the merchant Dashboard called
    // getTime() on it after a pull to refresh.
    expectWireSafe(res);
    expect(res.data.lastTransactionAt).toBe("2026-11-21T09:30:00.000Z");
    expect(res.data.balanceCents).toBe(1500);
  });

  it("sends null for a wallet that never moved money", async () => {
    restore = useFakeFirestore(
      fakeFirestore({ "users/u1": { accountType: "customer" }, "wallets/u1": wallet(0) })
    );
    const res = await call();
    expectWireSafe(res);
    expect(res.data.lastTransactionAt).toBeNull();
  });
});

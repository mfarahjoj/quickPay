import * as admin from "firebase-admin";
import {
  deleteDueAccount,
  deletionDue,
  isOrphanAuthUser,
  tombstone,
  ORPHAN_AUTH_MAX_AGE_MS,
} from "../auth/deleteAccount";
import { processReceipt } from "../mobileMoney/receipts";
import { fakeFirestore, useFakeFirestore, wallet } from "./helpers/fakeFirestore";

jest.mock("../utils/notifications", () => ({
  notifyTopupCompleted: jest.fn().mockResolvedValue(undefined),
}));

const NOW = Date.UTC(2026, 9, 25, 2);
const ts = (ms: number) => admin.firestore.Timestamp.fromMillis(ms);

describe("account deletion", () => {
  it("is due once the wait is over, and only once", () => {
    expect(deletionDue({ deletionDueAt: ts(NOW - 1) }, NOW)).toBe(true);
    expect(deletionDue({ deletionDueAt: ts(NOW + 1) }, NOW)).toBe(false);
    expect(deletionDue({ deletionDueAt: ts(NOW - 1), deleted: true }, NOW)).toBe(false);
    expect(deletionDue({}, NOW)).toBe(false);
    expect(deletionDue(undefined, NOW)).toBe(false);
  });

  it("leaves nothing that names the person", () => {
    const t = tombstone(
      {
        fullName: "Hodan Ali",
        phoneNumber: "+252634000001",
        email: "h@example.com",
        linkedAccounts: { zaadPhone: "+252634000001" },
        accountType: "customer",
        deletionRequestedAt: ts(NOW - 30 * 86400000),
      },
      NOW
    );
    expect(JSON.stringify(t)).not.toMatch(/Hodan|252634000001|example\.com/);
    expect(t).toMatchObject({ deleted: true, fullName: "Deleted account", isActive: false, accountType: "customer" });
  });
});

describe("deleting a due account", () => {
  let restore: (() => void) | undefined;
  let authSpy: jest.SpyInstance;

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
    authSpy = jest.spyOn(admin, "auth").mockReturnValue({
      deleteUser: jest.fn().mockResolvedValue(undefined),
    } as any);
  });
  afterEach(() => {
    restore?.();
    restore = undefined;
  });
  afterAll(() => authSpy.mockRestore());

  const seed = () => {
    const db = fakeFirestore({
      "users/u1": { fullName: "Hodan Ali", deletionDueAt: ts(NOW - 1) },
      "wallets/u1": wallet(0),
      "linked_numbers/zaad_252634000001": { uid: "u1", provider: "zaad", msisdn: "+252634000001", status: "verified" },
      "linked_numbers/edahab_252654000001": { uid: "u1", provider: "edahab", msisdn: "+252654000001", status: "pending" },
      "linked_numbers/zaad_252634000002": { uid: "u2", provider: "zaad", msisdn: "+252634000002", status: "verified" },
    });
    (db as any).recursiveDelete = async (ref: { path: string }) => {
      for (const p of [...db.store.keys()]) if (p === ref.path || p.startsWith(`${ref.path}/`)) db.store.delete(p);
    };
    restore = useFakeFirestore(db);
    return db;
  };

  it("forgets the Zaad and eDahab numbers they linked, and only theirs", async () => {
    const db = seed();
    await expect(deleteDueAccount("u1", NOW)).resolves.toBe("deleted");
    expect(db.get("linked_numbers/zaad_252634000001")).toBeUndefined();
    expect(db.get("linked_numbers/edahab_252654000001")).toBeUndefined();
    expect(db.get("linked_numbers/zaad_252634000002")).toMatchObject({ uid: "u2" });
  });

  it("won't delete an account that still holds shillings", async () => {
    const db = seed();
    db.store.set("wallets/u1", wallet(0, { sls: { balance: 500, totalSent: 0, totalReceived: 500 } }));
    await expect(deleteDueAccount("u1", NOW)).resolves.toBe("has_money");
    expect(db.get("users/u1")).toMatchObject({ fullName: "Hodan Ali", deletionBlocked: "has_money" });
    expect(db.get("wallets/u1")!.sls.balance).toBe(500);
  });

  it("holds a later payment from their old number instead of crediting the closed wallet", async () => {
    const db = seed();
    await deleteDueAccount("u1", NOW);
    const outcome = await processReceipt({
      provider: "zaad",
      operatorTxnId: "ZT1001",
      amountCents: 1000,
      currency: "USD",
      senderMsisdn: "+252634000001",
      senderName: null,
      receivedAtMs: NOW,
    });
    expect(outcome).toMatchObject({ status: "held", reason: "unknown_sender", uid: null });
    expect(db.get("wallets/u1")).toMatchObject({ balance: 0, status: "closed" });
  });
});

describe("abandoned sign-ups", () => {
  const signedIn = (msAgo: number) => ({
    metadata: { creationTime: new Date(NOW - msAgo).toUTCString(), lastSignInTime: new Date(NOW - msAgo).toUTCString() },
  });

  it("removes a week-old sign-in with no account behind it", () => {
    expect(isOrphanAuthUser(signedIn(ORPHAN_AUTH_MAX_AGE_MS + 60_000), false, NOW)).toBe(true);
  });

  it("keeps recent ones (still choosing a PIN) and anything with an account", () => {
    expect(isOrphanAuthUser(signedIn(3600_000), false, NOW)).toBe(false);
    expect(isOrphanAuthUser(signedIn(ORPHAN_AUTH_MAX_AGE_MS + 60_000), true, NOW)).toBe(false);
    expect(isOrphanAuthUser({ metadata: {} }, false, NOW)).toBe(false);
  });
});

import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";
import {
  prepareJournalEntry,
  userAccount,
  CurrencyMismatchError,
  PLATFORM_FEES,
} from "../ledger";
import { validateCurrency } from "../utils/validation";

/**
 * Amounts are bare integers, so the ledger is the last place that can stop
 * an SLS amount being taken from a USD wallet as dollars.
 */
describe("ledger currency guard", () => {
  let restore: (() => void) | undefined;

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  const seed = (): FakeDb => {
    const db = fakeFirestore({
      "wallets/a": wallet(10_000),
      "wallets/b": wallet(0),
      "wallets/legacy": { ...wallet(5_000), currency: undefined },
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const post = (db: FakeDb, currency: "USD" | "SLS", from = "a", to = "b") =>
    db.runTransaction(async (tx: any) => {
      const pending = await prepareJournalEntry(tx, {
        entryId: `test_${from}_${to}_${currency}`,
        type: "p2p",
        currency,
        lines: [
          { account: userAccount(from), debit: 1_000, credit: 0 },
          { account: userAccount(to), debit: 0, credit: 1_000 },
        ],
        description: "test",
        postedBy: from,
      });
      pending.write(tx);
    });

  it("refuses an SLS entry against USD wallets and moves nothing", async () => {
    const db = seed();
    await expect(post(db, "SLS")).rejects.toBeInstanceOf(CurrencyMismatchError);
    expect(db.get("wallets/a")!.balance).toBe(10_000);
    expect(db.get("wallets/b")!.balance).toBe(0);
    expect([...db.store.keys()].some((p) => p.startsWith("journal_entries/"))).toBe(false);
  });

  it("still posts a USD entry", async () => {
    const db = seed();
    await post(db, "USD");
    expect(db.get("wallets/a")!.balance).toBe(9_000);
    expect(db.get("wallets/b")!.balance).toBe(1_000);
  });

  it("treats a wallet with no stored currency as USD", async () => {
    const db = seed();
    await post(db, "USD", "legacy", "b");
    expect(db.get("wallets/legacy")!.balance).toBe(4_000);
    await expect(post(db, "SLS", "legacy", "b")).rejects.toBeInstanceOf(CurrencyMismatchError);
  });

  it("checks the credited wallet too", async () => {
    const db = fakeFirestore({
      "wallets/a": wallet(10_000),
      "wallets/sls": wallet(0, { currency: "SLS" }),
    });
    restore = useFakeFirestore(db);
    await expect(post(db, "USD", "a", "sls")).rejects.toBeInstanceOf(CurrencyMismatchError);
  });

  it("doesn't check platform accounts, which hold no wallet", async () => {
    const db = seed();
    await db.runTransaction(async (tx: any) => {
      const pending = await prepareJournalEntry(tx, {
        entryId: "test_fee",
        type: "qr_payment",
        currency: "USD",
        lines: [
          { account: userAccount("a"), debit: 100, credit: 0 },
          { account: PLATFORM_FEES, debit: 0, credit: 100 },
        ],
        description: "test",
        postedBy: "a",
      });
      pending.write(tx);
    });
    expect(db.get("wallets/a")!.balance).toBe(9_900);
  });

  it("accepts only USD at the callable edge", () => {
    expect(validateCurrency("USD")).toBe(true);
    expect(validateCurrency("SLS")).toBe(false);
    expect(validateCurrency("EUR")).toBe(false);
  });
});

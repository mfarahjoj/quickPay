import * as admin from "firebase-admin";
import { fakeFirestore, useFakeFirestore, wallet, FakeDb } from "./helpers/fakeFirestore";
import {
  prepareJournalEntry,
  userAccount,
  CurrencyMismatchError,
  InsufficientBalanceError,
  LedgerValidationError,
  PLATFORM_FEES,
  balanceKey,
  parseBalanceKey,
} from "../ledger";

/**
 * Amounts are bare integers, so the ledger is what keeps a shilling amount
 * from being taken as dollars: every wallet has a dollar balance and a
 * shilling pocket, and each entry moves exactly one of them.
 */
describe("ledger currencies", () => {
  let restore: (() => void) | undefined;

  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp();
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  const seed = (extra: Record<string, any> = {}): FakeDb => {
    const db = fakeFirestore({
      "wallets/a": wallet(10_000, { sls: { balance: 50_000, totalSent: 0, totalReceived: 50_000 } }),
      "wallets/b": wallet(0),
      "wallets/legacy": { ...wallet(5_000), currency: undefined },
      ...extra,
    });
    restore = useFakeFirestore(db);
    return db;
  };

  const post = (
    db: FakeDb,
    currency: "USD" | "SLS",
    amount: number,
    from = "a",
    to = "b",
    id = `test_${from}_${to}_${currency}`
  ) =>
    db.runTransaction(async (tx: any) => {
      const pending = await prepareJournalEntry(tx, {
        entryId: id,
        type: "p2p",
        currency,
        lines: [
          { account: userAccount(from), debit: amount, credit: 0 },
          { account: userAccount(to), debit: 0, credit: amount },
        ],
        description: "test",
        postedBy: from,
      });
      pending.write(tx);
    });

  it("moves shillings between pockets and leaves dollars alone", async () => {
    const db = seed();
    await post(db, "SLS", 30_000);
    const a = db.get("wallets/a")!;
    const b = db.get("wallets/b")!;
    expect(a.balance).toBe(10_000);
    expect(a.sls).toEqual({ balance: 20_000, totalSent: 30_000, totalReceived: 50_000 });
    expect(b.balance).toBe(0);
    expect(b.sls).toEqual({ balance: 30_000, totalSent: 0, totalReceived: 30_000 });
    expect(db.get("journal_entries/test_a_b_SLS")!.currency).toBe("SLS");
  });

  it("moves dollars without touching shillings", async () => {
    const db = seed();
    await post(db, "USD", 1_000);
    const a = db.get("wallets/a")!;
    expect(a.balance).toBe(9_000);
    expect(a.sls.balance).toBe(50_000);
    expect(db.get("wallets/b")!.sls).toBeUndefined();
  });

  it("refuses to spend shillings a wallet doesn't have, even with dollars to spare", async () => {
    const db = seed();
    // b has no shilling pocket at all; a has $100 but only 50,000 SLS.
    await expect(post(db, "SLS", 1, "b", "a")).rejects.toBeInstanceOf(InsufficientBalanceError);
    await expect(post(db, "SLS", 50_001)).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(db.get("wallets/a")!.sls.balance).toBe(50_000);
    expect([...db.store.keys()].some((p) => p.startsWith("journal_entries/"))).toBe(false);
  });

  it("treats a wallet with no stored currency as a dollar wallet that can hold shillings", async () => {
    const db = seed();
    await post(db, "USD", 1_000, "legacy", "b");
    expect(db.get("wallets/legacy")!.balance).toBe(4_000);
    await post(db, "SLS", 5_000, "a", "legacy");
    expect(db.get("wallets/legacy")!.sls.balance).toBe(5_000);
  });

  it("refuses dollars into a wallet whose main balance isn't dollars", async () => {
    const db = seed({ "wallets/odd": wallet(0, { currency: "SLS" }) });
    await expect(post(db, "USD", 100, "a", "odd")).rejects.toBeInstanceOf(CurrencyMismatchError);
  });

  it("refuses a currency the ledger doesn't know", async () => {
    const db = seed();
    await expect(post(db, "EUR" as any, 100)).rejects.toBeInstanceOf(LedgerValidationError);
  });

  it("keeps a platform account's shillings in a separate balance doc", async () => {
    const db = seed({ "ledger_balances/platform:fees": { account: PLATFORM_FEES, balance: 700, currency: "USD" } });
    await db.runTransaction(async (tx: any) => {
      const pending = await prepareJournalEntry(tx, {
        entryId: "test_fee_sls",
        type: "qr_payment",
        currency: "SLS",
        lines: [
          { account: userAccount("a"), debit: 1_000, credit: 0 },
          { account: PLATFORM_FEES, debit: 0, credit: 1_000 },
        ],
        description: "test",
        postedBy: "a",
      });
      pending.write(tx);
    });
    expect(db.get("ledger_balances/platform:fees")!.balance).toBe(700);
    expect(db.get("ledger_balances/platform:fees@SLS")).toMatchObject({
      account: PLATFORM_FEES,
      balance: 1_000,
      currency: "SLS",
    });
  });

  it("names dollar balances as before and shilling balances with @SLS", () => {
    expect(balanceKey("platform:fees", "USD")).toBe("platform:fees");
    expect(balanceKey("platform:fees", "SLS")).toBe("platform:fees@SLS");
    expect(parseBalanceKey("agent:x@SLS")).toEqual({ account: "agent:x", currency: "SLS" });
    expect(parseBalanceKey("user:x")).toEqual({ account: "user:x", currency: "USD" });
  });

  describe("invariant check", () => {
    const run = async () => {
      const { runInvariantCheck } = await import("../ledger/invariantCheck");
      return runInvariantCheck({ trigger: "manual", triggeredBy: "test" });
    };

    it("finds no drift after dollar and shilling postings", async () => {
      const db = fakeFirestore({
        "wallets/a": wallet(0),
        "wallets/b": wallet(0),
      });
      restore = useFakeFirestore(db);
      // Fund both pockets of a from the platform, then pay b in each currency.
      for (const [currency, amount] of [["USD", 2_000], ["SLS", 40_000]] as const) {
        await db.runTransaction(async (tx: any) => {
          const pending = await prepareJournalEntry(tx, {
            entryId: `fund_${currency}`,
            type: "adjustment",
            currency,
            lines: [
              { account: "platform:promo", debit: amount, credit: 0 },
              { account: userAccount("a"), debit: 0, credit: amount },
            ],
            description: "fund",
            postedBy: "test",
          });
          pending.write(tx);
        });
      }
      await post(db, "USD", 500);
      await post(db, "SLS", 15_000);

      const result = await run();
      expect(result.drifts).toEqual([]);
    });

    it("reports a shilling pocket that disagrees with the journal", async () => {
      const db = fakeFirestore({
        "journal_entries/fund_sls": {
          type: "adjustment",
          currency: "SLS",
          lines: [
            { account: "platform:promo", debit: 40_000, credit: 0 },
            { account: "user:a", debit: 0, credit: 40_000 },
          ],
          postedAt: admin.firestore.Timestamp.now(),
        },
        "ledger_balances/platform:promo@SLS": { balance: -40_000 },
        "wallets/a": wallet(0, { sls: { balance: 39_000, totalSent: 0, totalReceived: 40_000 } }),
      });
      restore = useFakeFirestore(db);

      const result = await run();
      expect(result.drifts).toEqual([
        expect.objectContaining({ account: "user:a@SLS", expected: 40_000, actual: 39_000 }),
      ]);
    });

    it("reports shillings in a wallet that no entry explains", async () => {
      const db = fakeFirestore({
        "wallets/a": wallet(0, { sls: { balance: 9_000, totalSent: 0, totalReceived: 9_000 } }),
      });
      restore = useFakeFirestore(db);

      const result = await run();
      expect(result.drifts).toEqual([
        expect.objectContaining({ account: "user:a@SLS", expected: 0, actual: 9_000 }),
      ]);
    });
  });
});

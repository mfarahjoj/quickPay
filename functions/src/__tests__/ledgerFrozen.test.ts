/**
 * Freeze enforcement at the ledger choke point.
 *
 * These are the tests that matter most for the freeze feature: the callable
 * layer can be forgotten at a new call site, but nothing moves value without
 * passing through prepareJournalEntry, so this is where the guarantee lives.
 */

jest.mock("firebase-admin", () => {
  const makeRef = (path: string) => ({ path, id: path.split("/").pop() });
  const firestore: any = jest.fn(() => ({
    collection: (name: string) => ({
      doc: (id: string) => makeRef(`${name}/${id}`),
    }),
  }));
  firestore.Timestamp = { now: () => ({ seconds: 0, nanoseconds: 0 }) };
  firestore.FieldValue = { increment: (n: number) => ({ __increment: n }) };
  return { firestore };
});

import {
  prepareJournalEntry,
  FrozenAccountError,
  InsufficientBalanceError,
  WalletNotFoundError,
} from "../ledger/post";
import { JournalEntryInput } from "../ledger/types";

interface FakeWallet {
  balance: number;
  totalSent?: number;
  totalReceived?: number;
  frozen?: unknown;
}

function makeTx(wallets: Record<string, FakeWallet>) {
  return {
    get: jest.fn(async (ref: any) => {
      if (ref.path.startsWith("journal_entries/")) {
        return { exists: false };
      }
      const uid = ref.path.split("/")[1];
      const data = wallets[uid];
      return {
        exists: data !== undefined,
        data: () => ({ totalSent: 0, totalReceived: 0, ...data }),
      };
    }),
    create: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
  } as any;
}

function transfer(from: string, to: string, amount = 1000): JournalEntryInput {
  return {
    entryId: `p2p_test_${from}_${to}`,
    type: "p2p",
    currency: "USD",
    lines: [
      { account: `user:${from}`, debit: amount, credit: 0 },
      { account: `user:${to}`, debit: 0, credit: amount },
    ],
    description: "test transfer",
    postedBy: from,
  };
}

describe("prepareJournalEntry — frozen accounts", () => {
  it("refuses to debit a frozen wallet", async () => {
    const tx = makeTx({
      alice: { balance: 5000, frozen: true },
      bob: { balance: 0 },
    });

    await expect(
      prepareJournalEntry(tx, transfer("alice", "bob"))
    ).rejects.toThrow(FrozenAccountError);
  });

  it("names the frozen account on the error", async () => {
    const tx = makeTx({
      alice: { balance: 5000, frozen: true },
      bob: { balance: 0 },
    });

    await expect(
      prepareJournalEntry(tx, transfer("alice", "bob"))
    ).rejects.toMatchObject({ account: "user:alice" });
  });

  // Deliberate: freezing stops value leaving, not arriving. Blocking credits
  // would strand in-flight reversals — a cash-out hold returned after expiry,
  // or a refund to a customer frozen in the meantime — with no way to settle.
  it("allows a credit to a frozen wallet", async () => {
    const tx = makeTx({
      alice: { balance: 5000 },
      bob: { balance: 0, frozen: true },
    });

    const prepared = await prepareJournalEntry(tx, transfer("alice", "bob"));
    expect(prepared.alreadyPosted).toBe(false);
    expect(prepared.resultingBalances.get("user:bob")).toBe(1000);
  });

  it("allows a refund back to a frozen customer", async () => {
    const tx = makeTx({
      merchant: { balance: 10000 },
      customer: { balance: 0, frozen: true },
    });

    await expect(
      prepareJournalEntry(tx, {
        entryId: "refund_test_1",
        type: "refund",
        currency: "USD",
        lines: [
          { account: "user:merchant", debit: 990, credit: 0 },
          { account: "platform:fees", debit: 10, credit: 0 },
          { account: "user:customer", debit: 0, credit: 1000 },
        ],
        description: "refund",
        postedBy: "merchant",
      })
    ).resolves.toBeDefined();
  });

  it("blocks the debit leg even when the frozen account also receives", async () => {
    // An agent confirming a top-up is debited float and credited commission in
    // the same entry; a frozen agent must not get through on the credit line.
    const tx = makeTx({
      agent: { balance: 50000, frozen: true },
      customer: { balance: 0 },
    });

    await expect(
      prepareJournalEntry(tx, {
        entryId: "agent_topup_test_1",
        type: "agent_topup",
        currency: "USD",
        lines: [
          { account: "user:agent", debit: 1000, credit: 0 },
          { account: "user:customer", debit: 0, credit: 1000 },
          { account: "platform:fees", debit: 20, credit: 0 },
          { account: "user:agent", debit: 0, credit: 20 },
        ],
        description: "agent top-up",
        postedBy: "agent",
      })
    ).rejects.toThrow(FrozenAccountError);
  });

  it("lets unfrozen accounts through unchanged", async () => {
    const tx = makeTx({
      alice: { balance: 5000 },
      bob: { balance: 0, frozen: false },
    });

    const prepared = await prepareJournalEntry(tx, transfer("alice", "bob"));
    expect(prepared.resultingBalances.get("user:alice")).toBe(4000);
    expect(prepared.resultingBalances.get("user:bob")).toBe(1000);
  });

  it("treats a wallet with no frozen field as spendable", async () => {
    // Every wallet predating the admin console has no `frozen` field.
    const tx = makeTx({ alice: { balance: 5000 }, bob: { balance: 0 } });

    await expect(
      prepareJournalEntry(tx, transfer("alice", "bob"))
    ).resolves.toBeDefined();
  });

  it("still enforces the existing guards", async () => {
    const broke = makeTx({ alice: { balance: 100 }, bob: { balance: 0 } });
    await expect(
      prepareJournalEntry(broke, transfer("alice", "bob"))
    ).rejects.toThrow(InsufficientBalanceError);

    const missing = makeTx({ bob: { balance: 0 } });
    await expect(
      prepareJournalEntry(missing, transfer("alice", "bob"))
    ).rejects.toThrow(WalletNotFoundError);
  });
});

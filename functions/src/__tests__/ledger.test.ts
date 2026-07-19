import {
  validateEntry,
  aggregateDeltas,
  LedgerValidationError,
} from "../ledger/validate";
import {
  userAccount,
  isUserAccount,
  userIdOf,
  enforcesNonNegative,
  isValidAccount,
  PLATFORM_FEES,
  FLOAT_AGENTS,
} from "../ledger/accounts";
import { JournalEntryInput } from "../ledger/types";

function entry(overrides: Partial<JournalEntryInput> = {}): JournalEntryInput {
  return {
    entryId: "p2p_tx1",
    type: "p2p",
    currency: "USD",
    lines: [
      { account: "user:alice", debit: 1000, credit: 0 },
      { account: "user:bob", debit: 0, credit: 1000 },
    ],
    description: "P2P Transfer",
    postedBy: "alice",
    ...overrides,
  };
}

describe("validateEntry", () => {
  it("accepts a balanced two-line entry", () => {
    expect(() => validateEntry(entry())).not.toThrow();
  });

  it("accepts a fee split (three lines) that balances", () => {
    expect(() =>
      validateEntry(
        entry({
          lines: [
            { account: "user:customer", debit: 1000, credit: 0 },
            { account: "user:merchant", debit: 0, credit: 990 },
            { account: PLATFORM_FEES, debit: 0, credit: 10 },
          ],
        })
      )
    ).not.toThrow();
  });

  it("rejects an unbalanced entry", () => {
    expect(() =>
      validateEntry(
        entry({
          lines: [
            { account: "user:alice", debit: 1000, credit: 0 },
            { account: "user:bob", debit: 0, credit: 999 },
          ],
        })
      )
    ).toThrow(LedgerValidationError);
  });

  it("rejects a single-line entry", () => {
    expect(() =>
      validateEntry(
        entry({ lines: [{ account: "user:alice", debit: 0, credit: 100 }] })
      )
    ).toThrow(LedgerValidationError);
  });

  it("rejects a line with both debit and credit set", () => {
    expect(() =>
      validateEntry(
        entry({
          lines: [
            { account: "user:alice", debit: 100, credit: 100 },
            { account: "user:bob", debit: 100, credit: 100 },
          ],
        })
      )
    ).toThrow(LedgerValidationError);
  });

  it("rejects non-integer and negative amounts", () => {
    for (const bad of [10.5, -100, 0, NaN, Infinity]) {
      expect(() =>
        validateEntry(
          entry({
            lines: [
              { account: "user:alice", debit: bad, credit: 0 },
              { account: "user:bob", debit: 0, credit: bad },
            ],
          })
        )
      ).toThrow(LedgerValidationError);
    }
  });

  it("rejects malformed accounts", () => {
    expect(() =>
      validateEntry(
        entry({
          lines: [
            { account: "wallets/alice", debit: 100, credit: 0 },
            { account: "user:bob", debit: 0, credit: 100 },
          ],
        })
      )
    ).toThrow(LedgerValidationError);
  });

  it("rejects a bad entryId", () => {
    expect(() => validateEntry(entry({ entryId: "has spaces" }))).toThrow(
      LedgerValidationError
    );
    expect(() => validateEntry(entry({ entryId: "" }))).toThrow(
      LedgerValidationError
    );
  });
});

describe("aggregateDeltas", () => {
  it("nets lines per account with credits positive", () => {
    const deltas = aggregateDeltas([
      { account: "user:customer", debit: 1000, credit: 0 },
      { account: "user:merchant", debit: 0, credit: 990 },
      { account: PLATFORM_FEES, debit: 0, credit: 10 },
    ]);
    const byAccount = new Map(deltas.map((d) => [d.account, d]));
    expect(byAccount.get("user:customer")!.delta).toBe(-1000);
    expect(byAccount.get("user:customer")!.debits).toBe(1000);
    expect(byAccount.get("user:merchant")!.delta).toBe(990);
    expect(byAccount.get("user:merchant")!.credits).toBe(990);
    expect(byAccount.get(PLATFORM_FEES)!.delta).toBe(10);
  });

  it("sums to zero across accounts for any balanced entry", () => {
    const deltas = aggregateDeltas([
      { account: FLOAT_AGENTS, debit: 0, credit: 5000 },
      { account: "user:agent", debit: 5000, credit: 0 },
      { account: "user:agent", debit: 0, credit: 100 },
      { account: PLATFORM_FEES, debit: 100, credit: 0 },
    ]);
    expect(deltas.reduce((sum, d) => sum + d.delta, 0)).toBe(0);
  });

  it("merges repeated accounts into one delta", () => {
    const deltas = aggregateDeltas([
      { account: "user:agent", debit: 5000, credit: 0 },
      { account: "user:agent", debit: 0, credit: 100 },
      { account: FLOAT_AGENTS, debit: 0, credit: 4900 },
    ]);
    const agent = deltas.find((d) => d.account === "user:agent")!;
    expect(agent.delta).toBe(-4900);
    expect(agent.debits).toBe(5000);
    expect(agent.credits).toBe(100);
  });
});

describe("accounts", () => {
  it("builds and parses user accounts", () => {
    expect(userAccount("abc123")).toBe("user:abc123");
    expect(isUserAccount("user:abc123")).toBe(true);
    expect(isUserAccount(PLATFORM_FEES)).toBe(false);
    expect(userIdOf("user:abc123")).toBe("abc123");
  });

  it("only user accounts enforce non-negative balances", () => {
    expect(enforcesNonNegative("user:abc")).toBe(true);
    expect(enforcesNonNegative(PLATFORM_FEES)).toBe(false);
    expect(enforcesNonNegative(FLOAT_AGENTS)).toBe(false);
  });

  it("validates account shapes", () => {
    expect(isValidAccount("user:abc_123-X")).toBe(true);
    expect(isValidAccount("platform:fees")).toBe(true);
    expect(isValidAccount("bogus:thing")).toBe(false);
    expect(isValidAccount("user:")).toBe(false);
    expect(isValidAccount("user:with space")).toBe(false);
  });
});

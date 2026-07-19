/**
 * Pure validation and aggregation for journal entries. No Firestore access —
 * unit-testable in isolation.
 */

import { JournalEntryInput, JournalLine } from "./types";
import { isValidAccount } from "./accounts";

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

function isPositiveIntCents(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/**
 * Throws LedgerValidationError unless the entry is well-formed:
 * >= 2 lines, valid accounts, exactly one positive-integer side per line,
 * and debits equal credits (zero-sum).
 */
export function validateEntry(input: JournalEntryInput): void {
  if (!input.entryId || !/^[A-Za-z0-9_-]{1,200}$/.test(input.entryId)) {
    throw new LedgerValidationError("Invalid entryId");
  }
  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    throw new LedgerValidationError("An entry needs at least two lines");
  }

  let debits = 0;
  let credits = 0;
  for (const line of input.lines) {
    if (!isValidAccount(line.account)) {
      throw new LedgerValidationError(`Invalid account: ${line.account}`);
    }
    const hasDebit = line.debit !== 0;
    const hasCredit = line.credit !== 0;
    if (hasDebit === hasCredit) {
      throw new LedgerValidationError(
        `Line for ${line.account} must set exactly one of debit/credit`
      );
    }
    const amount = hasDebit ? line.debit : line.credit;
    if (!isPositiveIntCents(amount)) {
      throw new LedgerValidationError(
        `Line for ${line.account} must be a positive integer in cents`
      );
    }
    debits += line.debit;
    credits += line.credit;
  }

  if (debits !== credits) {
    throw new LedgerValidationError(
      `Entry does not balance: debits ${debits} != credits ${credits}`
    );
  }
}

export interface AccountDelta {
  account: string;
  /** Signed change in the account's balance, in cents (credits − debits for liabilities). */
  delta: number;
  /** Sum of debits against this account (user wallets: adds to totalSent). */
  debits: number;
  /** Sum of credits to this account (user wallets: adds to totalReceived). */
  credits: number;
}

/**
 * Nets an entry's lines per account.
 *
 * Sign convention: for wallet-style (liability) accounts a credit increases
 * the balance and a debit decreases it, matching the intuitive "money in my
 * wallet" reading used by the existing `wallets` docs. Platform/float
 * projections use the same convention so `sum(all deltas) === 0` holds for
 * every entry.
 */
export function aggregateDeltas(lines: JournalLine[]): AccountDelta[] {
  const byAccount = new Map<string, AccountDelta>();
  for (const line of lines) {
    let agg = byAccount.get(line.account);
    if (!agg) {
      agg = { account: line.account, delta: 0, debits: 0, credits: 0 };
      byAccount.set(line.account, agg);
    }
    agg.debits += line.debit;
    agg.credits += line.credit;
    agg.delta += line.credit - line.debit;
  }
  return [...byAccount.values()];
}

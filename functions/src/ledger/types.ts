/**
 * Ledger types — see LEDGER_ARCHITECTURE.md.
 *
 * The journal (`journal_entries`) is the source of truth for all money.
 * Wallet docs and `ledger_balances` docs are cached projections written
 * atomically with each entry.
 */

export type JournalEntryType =
  | "p2p"
  | "qr_payment"
  | "customer_qr_payment"
  | "refund"
  | "agent_topup"
  | "agent_cashout"
  | "mobile_money_topup"
  | "mobile_money_cashout"
  | "stripe_topup"
  | "remittance"
  | "referral_bonus"
  | "payroll"
  /** Agent buys float: real value reaches a float account, agent is credited. */
  | "float_issue"
  /** Agent returns float for cash: agent is debited, float account credited. */
  | "float_withdraw"
  | "opening_balance"
  | "adjustment";

export type LedgerCurrency = "USD" | "SLS";

/** One leg of an entry. Exactly one of debit/credit is a positive integer (cents). */
export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
}

/** Business references linking an entry back to app objects. */
export interface JournalRefs {
  transactionId?: string;
  qrCodeId?: string;
  topupId?: string;
  remittanceId?: string;
  refundOfEntryId?: string;
}

export interface JournalEntryInput {
  /**
   * Idempotency key, used as the entry's document ID. Must be deterministic
   * per business event (e.g. `p2p_${transactionId}`) so a retry can never
   * post the same movement twice.
   */
  entryId: string;
  type: JournalEntryType;
  currency: LedgerCurrency;
  lines: JournalLine[];
  refs?: JournalRefs;
  description: string;
  /** uid of the initiating user, or "system". */
  postedBy: string;
}

/** Shape of a `journal_entries` document. Append-only; never updated. */
export interface JournalEntryDoc {
  type: JournalEntryType;
  currency: LedgerCurrency;
  lines: JournalLine[];
  refs: JournalRefs;
  description: string;
  postedBy: string;
  postedAt: FirebaseFirestore.Timestamp;
}

/** Shape of a `ledger_balances` projection doc (non-user accounts only). */
export interface LedgerBalanceDoc {
  account: string;
  /**
   * Signed cents, credit-positive: income/liability accounts read positive,
   * asset (float) accounts read negative when holding value. Invariant:
   * sum(all ledger_balances) + sum(all wallets balances) === 0.
   */
  balance: number;
  currency: LedgerCurrency;
  updatedAt: FirebaseFirestore.Timestamp;
}

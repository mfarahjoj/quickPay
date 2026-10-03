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
  /**
   * Customer approves, in the app, a charge a merchant raised through the
   * public API (online checkout or a POS integration). Same shape as
   * qr_payment: customer debited, merchant credited the net, fee to platform.
   */
  | "online_payment"
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
  /** Merchant asks for a payout: their wallet is debited into settlement hold. */
  | "payout_hold"
  /** Ops has sent the transfer: hold is debited, the float account credited. */
  | "payout_settled"
  /** Payout refused or withdrawn: the hold returns to the merchant. */
  | "payout_cancelled"
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
  /** Merchant settlement request behind a payout_* entry. */
  payoutId?: string;
  /** API charge (`api_charges`) behind an online_payment or its refund. */
  apiChargeId?: string;
  /** API refund (`api_refunds`) behind a partial or full API refund. */
  apiRefundId?: string;
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

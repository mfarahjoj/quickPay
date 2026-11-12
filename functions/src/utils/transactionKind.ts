/**
 * The `kind` of a transaction row (plan 3.1), for rows written before every
 * writer set one.
 *
 * Every writer sets `kind` now. For older rows it is read off the journal
 * entry id, whose prefix each flow has always chosen deterministically, so
 * no extra read is needed. getTransactions uses this at read time, and
 * scripts/backfill-transaction-kinds.js writes it onto the stored rows.
 */

import { Transaction, TransactionKind } from "../types";

/** Longest prefixes first: `refund_apicharge_` must win over `refund_`. */
const BY_ENTRY_PREFIX: Array<[string, TransactionKind]> = [
  ["refund_apicharge_", "refund"],
  ["mmcashoutrelease_", "mobile_money_cashout"],
  ["mmcashouthold_", "mobile_money_cashout"],
  ["cashoutrelease_", "cash_out"],
  ["payout_cancelled_", "payout"],
  ["payout_settled_", "payout"],
  ["float_withdraw_", "float"],
  ["cashouthold_", "cash_out"],
  ["paymerchant_", "merchant_payment"],
  ["manualtopup_", "cash_in"],
  ["stripetopup_", "card_topup"],
  ["payout_hold_", "payout"],
  ["adjustment_", "adjustment"],
  ["agenttopup_", "cash_in"],
  ["float_issue_", "float"],
  ["mmcashout_", "mobile_money_cashout"],
  ["apicharge_", "online_payment"],
  ["referral_", "referral"],
  ["payroll_", "payroll"],
  ["cashout_", "cash_out"],
  ["mmtopup_", "mobile_money_topup"],
  ["custqr_", "merchant_payment"],
  ["refund_", "refund"],
  ["remit_", "remittance"],
  ["qrpay_", "merchant_payment"],
  ["p2p_", "p2p"],
];

/** The row's kind: stored if present, otherwise derived. */
export function kindOf(tx: Pick<Transaction, "type" | "journalEntryId" | "apiChargeId"> & { kind?: TransactionKind }): TransactionKind {
  if (tx.kind) return tx.kind;
  const entryId = tx.journalEntryId ?? "";
  for (const [prefix, kind] of BY_ENTRY_PREFIX) {
    if (entryId.startsWith(prefix)) return kind;
  }
  if (tx.apiChargeId) return tx.type === "refund" ? "refund" : "online_payment";
  switch (tx.type) {
    case "refund":
      return "refund";
    case "referral":
      return "referral";
    case "adjustment":
      return "adjustment";
    case "topup":
      return "cash_in";
    case "withdrawal":
      return "cash_out";
    default:
      // A "payment" with no recognisable entry predates the ledger; the
      // only payments then were shop payments.
      return "merchant_payment";
  }
}

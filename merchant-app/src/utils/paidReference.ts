/**
 * The "this invoice is already paid" check, from the till's side.
 *
 * The server only looks a reference up when asked, because only the till
 * knows whether a reference names one sale ("Invoice No 37841") or a thing
 * that repeats all day ("Table 4"). This file makes that call, and reads the
 * earlier payment back out of the server's refusal.
 */

/** The earlier payment, as the server sends it in the refusal's details. */
export interface PriorPayment {
  reference: string;
  receiptNumber: string;
  /** Cents. */
  amount: number;
  currency: string;
  paidByName: string | null;
  /** ISO timestamp. */
  paidAt: string;
  /** How many payments have carried this reference. */
  count: number;
}

/**
 * Kinds of receipt number that restart or repeat — kitchen tickets reset
 * every day, tables are reused all day — so a match means nothing.
 */
const REPEATING_KINDS = new Set(['kot', 'table']);

/**
 * Whether to ask the server if `reference` has already been paid.
 *
 * `kind` is the identifier kind when the reference came off a scanned receipt
 * (see receiptParser), or null when it was typed. A typed reference is
 * checked when it carries a number of four digits or more: invoice and bill
 * numbers do, "Table 4" and "Order #12" don't.
 */
export function shouldCheckPaidReference(reference: string, kind: string | null): boolean {
  if (!reference.trim()) return false;
  if (kind) return !REPEATING_KINDS.has(kind);
  return /\d{4,}/.test(reference);
}

/** The earlier payment, if `error` is the server's "already paid" refusal. */
export function priorPaymentFromError(error: any): PriorPayment | null {
  const code: string | undefined = error?.code;
  if (code !== 'already-exists' && code !== 'functions/already-exists') return null;
  const prior = error?.details?.priorPayment ?? error?.userInfo?.details?.priorPayment;
  if (!prior || typeof prior.receiptNumber !== 'string' || typeof prior.amount !== 'number') {
    return null;
  }
  return {
    reference: String(prior.reference ?? ''),
    receiptNumber: prior.receiptNumber,
    amount: prior.amount,
    currency: String(prior.currency ?? 'USD'),
    paidByName: typeof prior.paidByName === 'string' ? prior.paidByName : null,
    paidAt: String(prior.paidAt ?? ''),
    count: typeof prior.count === 'number' ? prior.count : 1,
  };
}

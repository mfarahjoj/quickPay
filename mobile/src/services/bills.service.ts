import { functions } from './firebase.config';
import { Currency } from '../utils/money';

/**
 * Bills: a shop (water company, gym, school) sends the customer a bill. They
 * pay it with Face ID or their PIN, decline it, or turn on auto-pay for that
 * shop so bills up to a limit are paid on their due date
 * (functions/src/bills/).
 */

export type BillStatus = 'open' | 'paid' | 'declined' | 'cancelled';

export interface Bill {
  id: string;
  merchantId: string;
  merchantName: string;
  /** Cents, or whole shillings. */
  amount: number;
  currency: Currency;
  description: string;
  reference?: string;
  /** "YYYY-MM-DD", Hargeisa. */
  dueDate: string;
  status: BillStatus;
  seriesId?: string;
  createdAt?: string;
  resolvedAt?: string;
  paidBy?: 'customer' | 'autopay';
  transactionId?: string;
  receiptNumber?: string;
  autopayTries?: number;
}

export interface BillSeries {
  id: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: Currency;
  description: string;
  reference?: string;
  interval: 'weekly' | 'monthly';
  nextDueDate: string;
  active: boolean;
}

export interface BillAutopay {
  merchantId: string;
  merchantName: string;
  maxAmount: number;
  currency: Currency;
}

export type RequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

/** A direct payment the customer asked a shop for, waiting for the shop's answer. */
export interface DirectPaymentRequest {
  id: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: Currency;
  description: string;
  reference?: string;
  interval: 'weekly' | 'monthly';
  firstDueDate: string;
  autopay: boolean;
  status: RequestStatus;
  createdAt?: string;
}

export interface MyBills {
  bills: Bill[];
  series: BillSeries[];
  autopay: BillAutopay[];
  /** Absent from servers older than direct payment requests. */
  requests?: DirectPaymentRequest[];
}

export interface NewDirectPayment {
  /** The shop's number; or its id, for a shop that billed the customer before. */
  merchantPhone?: string;
  merchantId?: string;
  amount: number;
  currency: Currency;
  description: string;
  reference?: string;
  interval: 'weekly' | 'monthly';
  firstDueDate: string;
  autopay: boolean;
  /** PIN or Face ID token; needed only with auto-pay. */
  pin?: string;
  /** One per request, kept across retries. */
  idempotencyKey: string;
}

async function call<T>(name: string, data: unknown): Promise<T> {
  const result = await functions().httpsCallable(name)(data);
  const body = result.data as { success: boolean; error?: string; data: T };
  if (!body.success) throw new Error(body.error || 'Request failed');
  return body.data;
}

export const listMyBills = () => call<MyBills>('listMyBills', {});

/** Pays exactly the amount shown; `pin` may be a Face ID token. */
export const payBill = (bill: Bill, pin: string) =>
  call<{ billId: string; transactionId: string; receiptNumber?: string }>('payBill', {
    billId: bill.id,
    pin,
    expectedAmount: bill.amount,
  });

export const declineBill = (billId: string) => call<{ bill: Bill }>('declineBill', { billId });

export const setBillAutopay = (merchantId: string, maxAmount: number, currency: Currency, pin: string) =>
  call<{ autopay: BillAutopay }>('setBillAutopay', { merchantId, maxAmount, currency, pin });

export const disableBillAutopay = (merchantId: string) => call<unknown>('disableBillAutopay', { merchantId });

export const stopBillSeries = (seriesId: string) => call<unknown>('stopBillSeries', { seriesId });

export const requestDirectPayment = (req: NewDirectPayment) =>
  call<{ request: DirectPaymentRequest }>('requestDirectPayment', req);

export const cancelDirectPaymentRequest = (requestId: string) =>
  call<unknown>('cancelDirectPaymentRequest', { requestId });

/** Is this number a shop? The masked answer the Send money step uses. */
export async function lookupShop(
  phoneNumber: string,
): Promise<{ found: false; reason: 'not_found' | 'self' | 'not_shop' } | { found: true; name: string }> {
  const result = await functions().httpsCallable('lookupRecipient')({ phoneNumber });
  const body = result.data as {
    success: boolean;
    data?: { found: boolean; reason?: 'not_found' | 'self'; displayName?: string; isBusiness?: boolean };
  };
  const d = body.data;
  if (!body.success || !d || !d.found) return { found: false, reason: d?.reason ?? 'not_found' };
  if (!d.isBusiness) return { found: false, reason: 'not_shop' };
  return { found: true, name: d.displayName ?? '' };
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Auto-pay will pay this bill on its due date. */
export function autopayCovers(bill: Bill, autopay: BillAutopay[]): boolean {
  const setting = autopay.find((a) => a.merchantId === bill.merchantId);
  return !!setting && setting.currency === bill.currency && bill.amount <= setting.maxAmount;
}

/** Today in Hargeisa, "YYYY-MM-DD", to compare with due dates. */
export function hargeisaToday(now = Date.now()): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** "1 Dec 2026" in the app's language. Noon, so no time zone moves the day. */
export function formatDueDate(day: string, locale?: string): string {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(locale ? [locale] : [], { day: 'numeric', month: 'short', year: 'numeric' });
}

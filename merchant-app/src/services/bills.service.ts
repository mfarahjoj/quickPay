import { functions } from './firebase.config';
import type { FloatCurrency } from '../components/CurrencyToggle';

/**
 * Bills: the shop sends a customer a bill (water, membership, school fees),
 * once or repeating weekly or monthly. The customer pays it in Zapp Pay, or
 * auto-pays it on the due date. Sending moves no money, so it takes no PIN
 * (functions/src/bills/).
 */

export type BillStatus = 'open' | 'paid' | 'declined' | 'cancelled';
export type BillRepeat = 'none' | 'weekly' | 'monthly';

export interface Bill {
  id: string;
  customerName: string;
  /** Cents, or whole shillings. */
  amount: number;
  currency: FloatCurrency;
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
}

export interface BillSeries {
  id: string;
  customerName: string;
  amount: number;
  currency: FloatCurrency;
  description: string;
  reference?: string;
  interval: 'weekly' | 'monthly';
  nextDueDate: string;
  active: boolean;
}

/** A customer asking to be billed on a schedule (a direct payment). */
export interface DirectPaymentRequest {
  id: string;
  customerName: string;
  amount: number;
  currency: FloatCurrency;
  description: string;
  reference?: string;
  interval: 'weekly' | 'monthly';
  firstDueDate: string;
  /** The customer turned on auto-pay for it with their PIN. */
  autopay: boolean;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  createdAt?: string;
}

export interface NewBill {
  customerPhone: string;
  amount: number;
  currency: FloatCurrency;
  description: string;
  reference?: string;
  dueDate: string;
  repeat: BillRepeat;
  /** One per bill, kept across retries so a lost reply can't send it twice. */
  idempotencyKey: string;
}

async function call<T>(name: string, data: unknown): Promise<T> {
  const result = await functions().httpsCallable(name)(data);
  const body = result.data as { success: boolean; error?: string; data: T };
  if (!body.success) throw new Error(body.error || 'Request failed');
  return body.data;
}

export const createBill = (bill: NewBill) => call<{ bill: Bill; series?: BillSeries }>('createBill', bill);

export const merchantListBills = () =>
  call<{ bills: Bill[]; series: BillSeries[]; requests?: DirectPaymentRequest[] }>('merchantListBills', {});

/** Approving starts the repeating bill and sends its first one. */
export const answerDirectPaymentRequest = (requestId: string, approve: boolean) =>
  call<{ request: DirectPaymentRequest }>('answerDirectPaymentRequest', { requestId, approve });

export const cancelBill = (billId: string) => call<{ bill: Bill }>('cancelBill', { billId });

export const stopBillSeries = (seriesId: string) => call<unknown>('stopBillSeries', { seriesId });

/** Today in Hargeisa (UTC+3 all year), "YYYY-MM-DD". */
export function hargeisaToday(now = Date.now()): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "1 Dec 2026" in the app's language. Noon, so no time zone moves the day. */
export function formatDueDate(day: string, locale?: string): string {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(locale ? [locale] : [], { day: 'numeric', month: 'short', year: 'numeric' });
}

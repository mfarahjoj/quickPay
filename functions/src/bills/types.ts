/**
 * Bills: a shop (water company, gym, school) sends a customer a bill; the
 * customer pays it with their PIN, or turns on auto-pay for that shop up to a
 * most-per-bill they choose. See docs/BILLS.md.
 *
 * All three collections are server-only: apps read them through callables.
 */

import { Currency } from "../utils/money";

export const BILLS = "bills";
export const BILL_SERIES = "billSeries";
export const BILL_AUTOPAY = "billAutopay";
export const BILL_REQUESTS = "billRequests";

export type BillStatus =
  /** Waiting for the customer: pay, decline, or auto-pay on the due date. */
  | "open"
  | "paid"
  /** The customer said no. */
  | "declined"
  /** The shop withdrew it. */
  | "cancelled";

export type BillRepeat = "none" | "weekly" | "monthly";

export interface Bill {
  merchantId: string;
  /** The shop's name when the bill was sent, for the customer's list. */
  merchantName: string;
  customerId: string;
  /** The customer's name as the shop's list shows it ("Amina Y."). */
  customerName: string;
  /** In the currency's smallest unit: cents, or whole shillings. */
  amount: number;
  currency: Currency;
  /** What it is for: "Water, November", "Monthly membership". */
  description: string;
  /** The customer's number with the shop: meter, member or student number. */
  reference?: string;
  /** "YYYY-MM-DD", a Hargeisa calendar day. */
  dueDate: string;
  /** Midnight at the start of dueDate, Hargeisa time. Auto-pay runs from then. */
  dueAt: FirebaseFirestore.Timestamp;
  status: BillStatus;
  /** Set when a repeating bill sent it. */
  seriesId?: string;
  createdAt: FirebaseFirestore.Timestamp;
  /** When it stopped being open: paid, declined or cancelled. */
  resolvedAt?: FirebaseFirestore.Timestamp;
  paidBy?: "customer" | "autopay";
  transactionId?: string;
  receiptNumber?: string;
  journalEntryId?: string;
  /** Auto-pay tries that didn't go through, and why the last one didn't. */
  autopayTries?: number;
  autopayLastTriedAt?: FirebaseFirestore.Timestamp;
  autopayLastError?: string;
}

export interface BillSeries {
  merchantId: string;
  merchantName: string;
  customerId: string;
  customerName: string;
  amount: number;
  currency: Currency;
  description: string;
  reference?: string;
  interval: Exclude<BillRepeat, "none">;
  /**
   * Day of the month the first bill fell due, kept so a series that started
   * on the 31st comes back to the 31st after a short month.
   */
  anchorDay: number;
  /** Due date of the next bill this series will send. */
  nextDueDate: string;
  /** When to send it: a few days before it is due. */
  nextIssueAt: FirebaseFirestore.Timestamp;
  active: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  stoppedAt?: FirebaseFirestore.Timestamp;
  stoppedBy?: "merchant" | "customer";
}

/** Doc ID `${customerId}_${merchantId}`: one auto-pay setting per shop. */
export interface BillAutopay {
  customerId: string;
  merchantId: string;
  merchantName: string;
  /** The most one bill may be for and still be paid without asking. */
  maxAmount: number;
  currency: Currency;
  active: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * A customer asks a shop to bill them on a schedule (a direct payment): "take
 * $25 every month for my gym membership". The shop approves or declines.
 * Approving starts a repeating bill and, if the customer asked, auto-pay.
 */
export type BillRequestStatus = "pending" | "approved" | "declined" | "cancelled";

export interface BillRequest {
  customerId: string;
  customerName: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: Currency;
  description: string;
  reference?: string;
  interval: Exclude<BillRepeat, "none">;
  /** "YYYY-MM-DD": when the customer wants the first payment. */
  firstDueDate: string;
  /** The customer gave their PIN to have these paid automatically. */
  autopay: boolean;
  status: BillRequestStatus;
  createdAt: FirebaseFirestore.Timestamp;
  resolvedAt?: FirebaseFirestore.Timestamp;
  /** Set on approval. */
  seriesId?: string;
  firstBillId?: string;
}

export function autopayId(customerId: string, merchantId: string): string {
  return `${customerId}_${merchantId}`;
}

/** The ledger entry that pays a bill: one per bill, ever. */
export function billEntryId(billId: string): string {
  return `bill_${billId}`;
}

/** Limits that keep bills from becoming a way to spam or probe customers. */
export const BILL_LIMITS = {
  /** Bills (and number lookups) one shop may send. */
  sendPerHour: 60,
  sendPerDay: 300,
  /** Open bills one shop may have with one customer at once. */
  openPerCustomer: 10,
  /** The latest a due date may be. */
  maxDaysAhead: 90,
  descriptionMax: 80,
  /** Auto-pay tries before a bill waits for the customer to pay it. */
  autopayMaxTries: 3,
  /** Repeating bills are sent this many days before they are due. */
  issueDaysBefore: 3,
  /** Direct payment requests one customer may send, and have waiting at once. */
  requestPerHour: 10,
  requestPerDay: 30,
  pendingRequests: 5,
  /** The latest a requested first payment may be. */
  requestMaxDaysAhead: 60,
};

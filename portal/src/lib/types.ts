/**
 * Shapes of the docs and callable replies Zapp Business reads. Mirrors
 * functions/src/merchantStats/types.ts and functions/src/portal/data.ts.
 *
 * Amounts are integers in the currency's smallest unit: cents for USD,
 * whole shillings for SLS. The two are never added together.
 */

export const CURRENCIES = ["USD", "SLS"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CHANNELS = ["sale_qr", "sticker", "scan", "display_scan", "online"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface MoneyTally {
  count: number;
  gross: number;
  fee: number;
  net: number;
}

export interface CurrencyPeriod {
  sales: MoneyTally;
  refunds: MoneyTally;
  hours: { count: number[]; net: number[] };
  channels: Record<Channel, { count: number; net: number }>;
  agent: { cashIn: { count: number; amount: number }; cashOut: { count: number; amount: number }; commission: number };
}

export interface DayStats {
  storeUid: string;
  period: string;
  currencies: Partial<Record<Currency, CurrencyPeriod>>;
  customers: { unique: number; new: number; returning: number };
  lastSaleAtMs?: number;
  updatedAtMs: number;
}

export interface RecentItem {
  txId: string;
  type: "sale" | "refund";
  currency: Currency;
  gross: number;
  net: number;
  atMs: number;
  channel?: Channel;
  customerName?: string;
}

export interface StoreInfo {
  storeUid: string;
  name: string;
  area: string | null;
  businessType: string | null;
  accountType: string | null;
  autoPayout: boolean;
  balances: Record<Currency, number>;
  displays: Array<{ name: string; online: boolean; lastSeenAtMs: number | null }>;
}

export interface PortalStore {
  merchantUid: string;
  stores: StoreInfo[];
  session: { sessionId: string; browser: string; expiresAtMs: number };
  serverNowMs: number;
}

export interface CustomerRow {
  customerUid: string;
  name: string | null;
  visits: number;
  visitDays: number;
  spend: Partial<Record<Currency, number>>;
  refunded: Partial<Record<Currency, number>>;
  firstSeenDay: string;
  lastSeenDay: string;
  lastSeenAtMs: number;
  usualGapDays: number | null;
  daysSinceLastVisit: number;
  lapseThresholdDays: number;
  monthlyValue: Record<Currency, number>;
}

export type CustomerView = "top" | "recent" | "new" | "lapsed";

export interface CustomerSale {
  id: string;
  atMs: number;
  currency: Currency;
  gross: number;
  net: number;
  refunded: number;
  reference: string | null;
  receiptNumber: string | null;
}

export interface TxRow {
  id: string;
  kind: string;
  status: string;
  incoming: boolean;
  currency: Currency;
  gross: number;
  fee: number;
  net: number;
  commission: number;
  refunded: number;
  counterpartyName: string | null;
  description: string;
  reference: string | null;
  receiptNumber: string | null;
  createdAtMs: number;
}

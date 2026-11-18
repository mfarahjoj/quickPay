/**
 * Merchant insights read model (MERCHANT_INSIGHTS.md).
 *
 * Everything under `merchantStats/{storeUid}` is a projection of the
 * `transactions` rows, kept by `merchantStatsOnTransaction` and checked
 * nightly against them. None of it moves or holds value: the ledger stays
 * the source of truth, and nothing here is ever read by a money flow.
 *
 * Amounts are integers in the currency's smallest unit (cents for USD,
 * whole shillings for SLS) and are kept per currency. Dollars and shillings
 * are never added together, here or on screen (SHILLINGS.md).
 *
 * Times are epoch milliseconds (`…Ms`). Days, months and hours are
 * Hargeisa local time (`STATS_TIME_ZONE`).
 */

export const STATS_CURRENCIES = ["USD", "SLS"] as const;
export type StatsCurrency = (typeof STATS_CURRENCIES)[number];

/**
 * How the customer paid, read off the journal entry id the flow chose:
 * - `sale_qr`: a sale QR the cashier made for an amount (`qrpay_`), on the
 *   phone or the counter display
 * - `sticker`: the shop's printed My QR, the customer types the amount (`paymerchant_`)
 * - `scan`: the cashier's phone scanned the customer's code (`custqr_`)
 * - `display_scan`: the counter tablet scanned the customer's code (`custqr_`
 *   whose payment request has `source: "counter_display"`)
 * - `online`: the Merchant Payments API: checkout links, tills, partner apps (`apicharge_`)
 */
export const SALE_CHANNELS = ["sale_qr", "sticker", "scan", "display_scan", "online"] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];

export interface MoneyTally {
  count: number;
  /** What the customer paid (sales) or got back (refunds). */
  gross: number;
  /** Zapp's fee kept (sales) or returned to the shop (refunds). */
  fee: number;
  /** What reached the shop (sales) or left it (refunds). */
  net: number;
}

export interface ChannelTally {
  count: number;
  net: number;
}

/** One currency's activity over a day or a month. */
export interface CurrencyPeriod {
  sales: MoneyTally;
  refunds: MoneyTally;
  /** Sales by local hour of day, 24 slots. */
  hours: { count: number[]; net: number[] };
  channels: Record<SaleChannel, ChannelTally>;
  /** Agent work, for agent merchants: cash handed in and out, and what it earned. */
  agent: {
    cashIn: { count: number; amount: number };
    cashOut: { count: number; amount: number };
    commission: number;
  };
}

/** Distinct paying customers in the period; currency doesn't matter here. */
export interface CustomerTally {
  unique: number;
  /** Paid this shop for the first time ever in the period. */
  new: number;
  /** unique - new. */
  returning: number;
}

/** `merchantStats/{storeUid}/days/{YYYY-MM-DD}` and `/months/{YYYY-MM}`. */
export interface PeriodStats {
  storeUid: string;
  /** "2026-11-18" for a day doc, "2026-11" for a month doc. */
  period: string;
  currencies: Partial<Record<StatsCurrency, CurrencyPeriod>>;
  customers: CustomerTally;
  lastSaleAtMs?: number;
  updatedAtMs: number;
}

/** `merchantStats/{storeUid}/customers/{customerUid}`: one customer at one shop. */
export interface CustomerStats {
  customerUid: string;
  firstSeenAtMs: number;
  firstSeenDay: string;
  lastSeenAtMs: number;
  lastSeenDay: string;
  /** Sales, all currencies. */
  visits: number;
  /** Distinct local days with a sale. */
  visitDays: number;
  /** Gross paid, per currency. */
  spend: Partial<Record<StatsCurrency, number>>;
  /** Gross refunded to them, per currency. */
  refunded: Partial<Record<StatsCurrency, number>>;
  /**
   * Usual days between visit days, smoothed (EWMA), or null until the second
   * visit day. Drives "a regular who hasn't come back".
   */
  usualGapDays: number | null;
  /** For queries ordering by spend without knowing the currency in advance. */
  spendUSD: number;
  spendSLS: number;
  updatedAtMs: number;
}

export interface RecentItem {
  txId: string;
  type: "sale" | "refund";
  currency: StatsCurrency;
  gross: number;
  net: number;
  atMs: number;
  channel?: SaleChannel;
  /** "Amina H.": enough for a live feed, no more. */
  customerName?: string;
}

/** `merchantStats/{storeUid}/live/recent`: the last sales and refunds, newest first. */
export interface RecentFeed {
  items: RecentItem[];
  updatedAtMs: number;
}

/** `merchantStats/{storeUid}`: one per shop, for "which shops were active". */
export interface StoreStatsRoot {
  storeUid: string;
  firstActivityAtMs: number;
  lastActivityAtMs: number;
  /** Local day of the last activity, so nightly jobs can find active shops. */
  lastActivityDay: string;
  lastSaleAtMs?: number;
  updatedAtMs: number;
}

interface EventBase {
  storeUid: string;
  txId: string;
  currency: StatsCurrency;
  atMs: number;
}

/** What one completed `transactions` row means to one shop. */
export type StoreEvent =
  | (EventBase & {
      type: "sale";
      customerUid: string;
      gross: number;
      fee: number;
      net: number;
      channel: SaleChannel;
      /** custqr_ only: the payment request, to tell the tablet from the phone. */
      requestId?: string;
    })
  | (EventBase & {
      type: "refund";
      customerUid: string;
      gross: number;
      fee: number;
      net: number;
    })
  | (EventBase & {
      type: "cash_in" | "cash_out";
      amount: number;
      commission: number;
    });

export const RECENT_MAX = 20;

/**
 * What a completed `transactions` row means to a shop. Pure.
 *
 * Each row concerns at most one shop:
 * - a shop payment or API payment → a sale for the receiver (`toUserId`)
 * - a refund → a refund by the payer of the original sale (`fromUserId`)
 * - an agent cash-in → work for the agent who handed it in (`fromUserId`)
 * - an agent cash-out → work for the agent who paid it out (`toUserId`)
 *
 * Everything else (P2P, payroll, payouts, top-ups by card, float, ledger
 * corrections) is not shop activity and returns null.
 */

import { Transaction } from "../types";
import { kindOf } from "../utils/transactionKind";
import { SaleChannel, StatsCurrency, StoreEvent, STATS_CURRENCIES } from "./types";

type Row = Partial<Transaction> & { kind?: Transaction["kind"] };

function toMs(v: unknown): number | undefined {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

/** Rows written before shillings carry no currency, and were dollars. */
export function statsCurrency(c: unknown): StatsCurrency | null {
  if (c === undefined || c === null || c === "") return "USD";
  return (STATS_CURRENCIES as readonly string[]).includes(c as string) ? (c as StatsCurrency) : null;
}

/** The sale channel and, for a scanned customer code, the request to check. */
export function saleChannel(row: Row): { channel: SaleChannel; requestId?: string } {
  const entry = row.journalEntryId ?? "";
  if (entry.startsWith("apicharge_") || row.apiChargeId) return { channel: "online" };
  if (entry.startsWith("paymerchant_")) return { channel: "sticker" };
  if (entry.startsWith("custqr_")) return { channel: "scan", requestId: entry.slice("custqr_".length) };
  // qrpay_ and rows from before the ledger, when a sale QR was the only way to pay.
  return { channel: "sale_qr" };
}

const int = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0);

export function classifyTransaction(txId: string, row: Row | undefined): StoreEvent | null {
  if (!row || row.status !== "completed") return null;
  const currency = statsCurrency(row.currency);
  if (!currency) return null;
  const atMs = toMs(row.completedAt) ?? toMs(row.createdAt);
  if (atMs === undefined) return null;

  const from = typeof row.fromUserId === "string" ? row.fromUserId : "";
  const to = typeof row.toUserId === "string" ? row.toUserId : "";
  const amount = int(row.amount);
  if (amount <= 0) return null;

  const kind = kindOf(row as Transaction);
  const base = { txId, currency, atMs };

  if ((kind === "merchant_payment" || kind === "online_payment") && row.type === "payment") {
    if (!to || !from || from === to) return null;
    const fee = int(row.feeCents);
    const net = row.netCents !== undefined ? int(row.netCents) : amount - fee;
    return { ...base, type: "sale", storeUid: to, customerUid: from, gross: amount, fee, net, ...saleChannel(row) };
  }

  if (kind === "refund" && row.type === "refund") {
    if (!to || !from || from === to) return null;
    const fee = int(row.feeCents);
    const net = row.netCents !== undefined ? int(row.netCents) : amount - fee;
    return { ...base, type: "refund", storeUid: from, customerUid: to, gross: amount, fee, net };
  }

  if (kind === "cash_in" && row.type === "topup") {
    // Only agent cash-ins have an agent as payer; card and mobile-money
    // top-ups have their own kinds.
    if (!from || from === to) return null;
    return { ...base, type: "cash_in", storeUid: from, amount, commission: int(row.commissionCents) };
  }

  if (kind === "cash_out" && row.type === "withdrawal") {
    if (!to || from === to) return null;
    return { ...base, type: "cash_out", storeUid: to, amount, commission: int(row.commissionCents) };
  }

  return null;
}

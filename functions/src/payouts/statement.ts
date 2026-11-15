/**
 * Merchant statement (plan 3.6, decision D11): every transaction in a
 * period as CSV, for the merchant's own books, a bank or an accountant.
 *
 * Money in and money out are separate columns, with the fee and net on each
 * row, so the totals reconcile without the reader knowing Zapp's sign
 * conventions. A period is at most 93 days; the merchant app asks for a
 * calendar month.
 *
 * Dollars and shillings are never added together (SHILLINGS.md): each row
 * says its currency, and each currency has its own totals line. `totals`
 * stays dollars only, as older merchant apps show it; `totalsSls` is the
 * shillings.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, Transaction } from "../types";
import { requireAuth } from "../utils/validation";
import { kindOf } from "../utils/transactionKind";
import { parseCurrency } from "../utils/money";

const MAX_PERIOD_MS = 93 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

/** Quote a CSV field when it needs it, and defuse spreadsheet formulas. */
export function csvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** "12.50" for dollars, "30000" for whole shillings. */
const amountText = (amount: number, currency: "USD" | "SLS") =>
  currency === "SLS" ? String(Math.round(amount)) : (amount / 100).toFixed(2);

export interface StatementTotals {
  inCents: number;
  outCents: number;
  feeCents: number;
  count: number;
}

export function buildStatementCsv(
  uid: string,
  rows: Array<Transaction & { id: string }>
): { csv: string; totals: StatementTotals; totalsSls: StatementTotals } {
  const header = ["Date (UTC)", "Type", "Description", "Currency", "Money in", "Money out", "Fee", "Status", "Reference", "Transaction ID"];
  const lines = [header.join(",")];
  const totals: StatementTotals = { inCents: 0, outCents: 0, feeCents: 0, count: 0 };
  const totalsSls: StatementTotals = { inCents: 0, outCents: 0, feeCents: 0, count: 0 };

  for (const t of rows) {
    // Value that reached this account counts as in; value that left, out.
    // A completed payment received records its net in and its fee.
    const incoming = t.toUserId === uid && t.fromUserId !== uid;
    const fee = incoming ? t.feeCents ?? 0 : 0;
    const moved = incoming ? t.netCents ?? t.amount - fee : t.amount;
    const currency = parseCurrency(t.currency) ?? "USD";
    const sum = currency === "SLS" ? totalsSls : totals;
    const counts = t.status === "completed";
    if (counts) {
      if (incoming) sum.inCents += moved;
      else sum.outCents += moved;
      sum.feeCents += fee;
    }
    sum.count++;
    const money = (n: number) => amountText(n, currency);
    lines.push(
      [
        t.createdAt.toDate().toISOString().replace("T", " ").slice(0, 19),
        kindOf(t),
        t.description,
        currency === "SLS" ? "SLSH" : "USD",
        incoming ? money(moved) : "",
        incoming ? "" : money(moved),
        fee ? money(fee) : "",
        t.status,
        t.reference ?? "",
        t.id,
      ]
        .map(csvField)
        .join(",")
    );
  }
  lines.push("");
  const totalsLine = (t: StatementTotals, currency: "USD" | "SLS") =>
    ["Totals (completed only)", "", "", currency === "SLS" ? "SLSH" : "USD",
      amountText(t.inCents, currency), amountText(t.outCents, currency), amountText(t.feeCents, currency),
      "", "", ""].join(",");
  lines.push(totalsLine(totals, "USD"));
  if (totalsSls.count > 0) lines.push(totalsLine(totalsSls, "SLS"));
  return { csv: lines.join("\n"), totals, totalsSls };
}

export const getStatement = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ fromMs: number; toMs: number }>
  ): Promise<ApiResponse<{ csv: string; totals: StatementTotals; totalsSls: StatementTotals; truncated: boolean }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const { fromMs, toMs } = request.data ?? ({} as { fromMs: number; toMs: number });
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > MAX_PERIOD_MS) {
      throw new https.HttpsError("invalid-argument", "Choose a period of up to three months");
    }

    const snap = await admin
      .firestore()
      .collection("transactions")
      .where("participants", "array-contains", uid)
      .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(fromMs))
      .where("createdAt", "<", admin.firestore.Timestamp.fromMillis(toMs))
      .orderBy("createdAt", "asc")
      .limit(MAX_ROWS + 1)
      .get();

    const rows = snap.docs.slice(0, MAX_ROWS).map((d) => ({ ...(d.data() as Transaction), id: d.id }));
    const { csv, totals, totalsSls } = buildStatementCsv(uid, rows);
    return { success: true, data: { csv, totals, totalsSls, truncated: snap.size > MAX_ROWS } };
  }
);

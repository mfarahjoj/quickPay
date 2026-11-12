/**
 * Merchant statement (plan 3.6, decision D11): every transaction in a
 * period as CSV, for the merchant's own books, a bank or an accountant.
 *
 * Money in and money out are separate columns, with the fee and net on each
 * row, so the totals reconcile without the reader knowing Zapp's sign
 * conventions. A period is at most 93 days; the merchant app asks for a
 * calendar month.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, Transaction } from "../types";
import { requireAuth } from "../utils/validation";
import { kindOf } from "../utils/transactionKind";

const MAX_PERIOD_MS = 93 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

/** Quote a CSV field when it needs it, and defuse spreadsheet formulas. */
export function csvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export interface StatementTotals {
  inCents: number;
  outCents: number;
  feeCents: number;
  count: number;
}

export function buildStatementCsv(
  uid: string,
  rows: Array<Transaction & { id: string }>
): { csv: string; totals: StatementTotals } {
  const header = ["Date (UTC)", "Type", "Description", "Money in", "Money out", "Fee", "Status", "Reference", "Transaction ID"];
  const lines = [header.join(",")];
  const totals: StatementTotals = { inCents: 0, outCents: 0, feeCents: 0, count: 0 };

  for (const t of rows) {
    // Value that reached this account counts as in; value that left, out.
    // A completed payment received records its net in and its fee.
    const incoming = t.toUserId === uid && t.fromUserId !== uid;
    const fee = incoming ? t.feeCents ?? 0 : 0;
    const moved = incoming ? t.netCents ?? t.amount - fee : t.amount;
    const counts = t.status === "completed";
    if (counts) {
      if (incoming) totals.inCents += moved;
      else totals.outCents += moved;
      totals.feeCents += fee;
    }
    totals.count++;
    lines.push(
      [
        t.createdAt.toDate().toISOString().replace("T", " ").slice(0, 19),
        kindOf(t),
        t.description,
        incoming ? dollars(moved) : "",
        incoming ? "" : dollars(moved),
        fee ? dollars(fee) : "",
        t.status,
        t.reference ?? "",
        t.id,
      ]
        .map(csvField)
        .join(",")
    );
  }
  lines.push("");
  lines.push(["Totals (completed only)", "", "", dollars(totals.inCents), dollars(totals.outCents), dollars(totals.feeCents), "", "", ""].join(","));
  return { csv: lines.join("\n"), totals };
}

export const getStatement = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ fromMs: number; toMs: number }>
  ): Promise<ApiResponse<{ csv: string; totals: StatementTotals; truncated: boolean }>> => {
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
    const { csv, totals } = buildStatementCsv(uid, rows);
    return { success: true, data: { csv, totals, truncated: snap.size > MAX_ROWS } };
  }
);

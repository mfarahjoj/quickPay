import { useCallback, useEffect, useState } from "react";
import { exportStatement, listTransactions } from "../api";
import { StringKey, useI18n } from "../i18n";
import { clock, iso, ltr, money, moneyPlain, shortDate } from "../lib/format";
import { addDays, dayStartMs, localParts } from "../lib/time";
import { TxRow } from "../lib/types";

export type TxFilter = "all" | "sales" | "refunds";
const KNOWN = new Set(["merchant_payment", "online_payment", "refund", "payout", "payroll", "cash_in", "cash_out"]);

/** The last six calendar months, Hargeisa time, newest first. */
function months(today: string): Array<{ key: string; fromMs: number; toMs: number }> {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const next = new Date(Date.UTC(y, m - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
    return { key, fromMs: dayStartMs(`${key}-01`), toMs: dayStartMs(nextKey) };
  });
}

export function Transactions(props: { storeUid: string; filter: TxFilter; onFilter: (f: TxFilter) => void; refreshKey: number; onError: (e: unknown) => void; today: string }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const monthList = months(props.today);
  const [month, setMonth] = useState(monthList[0].key);
  const { storeUid, onError } = props;

  const load = useCallback(
    async (after: number | null) => {
      setLoading(true);
      try {
        const r = await listTransactions(storeUid, after);
        setRows((prev) => (after ? [...prev, ...r.transactions] : r.transactions));
        setCursor(r.nextCursor);
      } catch (e) {
        onError(e);
      } finally {
        setLoading(false);
      }
    },
    [storeUid, onError]
  );

  useEffect(() => {
    load(null);
  }, [load, props.refreshKey]);

  const shown = rows.filter((r) =>
    props.filter === "all" ? true : props.filter === "refunds" ? r.kind === "refund" : r.kind === "merchant_payment" || r.kind === "online_payment"
  );

  const download = async () => {
    const m = monthList.find((x) => x.key === month)!;
    setExporting(true);
    try {
      const { csv } = await exportStatement(storeUid, m.fromMs, m.toMs);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `zapp-statement-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="card span-12" id="transactions">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <h2 className="card-title" style={{ flex: 1 }}>
          {t("tx.title")}
        </h2>
        <div className="seg">
          {(["all", "sales", "refunds"] as TxFilter[]).map((f) => (
            <button key={f} aria-pressed={props.filter === f} onClick={() => props.onFilter(f)}>
              {t(`tx.filter.${f}` as StringKey)}
            </button>
          ))}
        </div>
        <select className="ghost" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("tx.month")}>
          {monthList.map((m) => (
            <option key={m.key} value={m.key}>
              {new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : lang === "so" ? "so" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
                new Date(`${m.key}-15T00:00:00Z`)
              )}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={download} disabled={exporting}>
          {exporting ? t("tx.exporting") : t("tx.export")}
        </button>
      </div>
      <div className={loading && rows.length ? "refetching table-wrap" : "table-wrap"}>
        {shown.length === 0 && !loading ? (
          <div className="empty">{t("tx.empty")}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("tx.col.time")}</th>
                <th>{t("tx.col.who")}</th>
                <th>{t("tx.col.what")}</th>
                <th className="num">{t("tx.col.amount")}</th>
                <th className="num">{t("tx.col.fee")}</th>
                <th className="num">{t("tx.col.net")}</th>
                <th>{t("tx.col.receipt")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const day = localParts(r.createdAtMs).day;
                const when = day === props.today ? clock(r.createdAtMs) : day === addDays(props.today, -1) ? `${t("customers.yesterday")} ${clock(r.createdAtMs)}` : `${shortDate(day, lang)} ${clock(r.createdAtMs)}`;
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{when}</td>
                    <td>{r.counterpartyName ? iso(r.counterpartyName) : "–"}</td>
                    <td>
                      {t(`tx.kind.${KNOWN.has(r.kind) ? r.kind : "other"}` as StringKey)}
                      {r.refunded > 0 && r.kind !== "refund" ? <> <span className="pill">{t("tx.refunded")}</span></> : null}
                      {r.status !== "completed" ? <> <span className="pill">{r.status}</span></> : null}
                    </td>
                    <td className="num">
                      {ltr(`${r.incoming ? "" : "−"}${moneyPlain(r.gross, r.currency)}`)}
                    </td>
                    <td className="num">{r.fee ? money(r.fee, r.currency) : ""}</td>
                    <td className="num">{r.incoming ? money(r.net, r.currency) : ""}</td>
                    <td className="hint">{r.receiptNumber ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {cursor !== null && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button className="ghost" onClick={() => load(cursor)} disabled={loading}>
            {t("tx.more")}
          </button>
        </div>
      )}
    </section>
  );
}

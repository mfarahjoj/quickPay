import { useEffect, useState } from "react";
import { getCustomer, getCustomers } from "../api";
import { StringKey, useI18n } from "../i18n";
import { clock, count, iso, money, shortDate } from "../lib/format";
import { localParts } from "../lib/time";
import { CustomerRow, CustomerSale, CustomerView, Currency } from "../lib/types";

const TABS: CustomerView[] = ["top", "lapsed", "new", "recent"];

/** "Every day", "3 days", or a dash before a second visit day. */
function useGapText() {
  const { t } = useI18n();
  return (gap: number | null) => {
    if (gap === null) return "–";
    const n = Math.max(1, Math.round(gap));
    return n === 1 ? t("customers.everyDay") : t("customers.everyDays", { count: n });
  };
}

export function Customers(props: {
  storeUid: string;
  currency: Currency;
  tab: CustomerView;
  onTab: (v: CustomerView) => void;
  /** Bumped on every sale, so lists refresh with the live data. */
  refreshKey: number;
  onError: (e: unknown) => void;
}) {
  const { t, lang } = useI18n();
  const gapText = useGapText();
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [openUid, setOpenUid] = useState<string | null>(null);
  const { storeUid, currency, tab, onError } = props;

  useEffect(() => {
    let live = true;
    setLoading(true);
    getCustomers(storeUid, tab, currency, 15)
      .then((r) => live && setRows(r.customers))
      .catch((e) => live && onError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [storeUid, tab, currency, props.refreshKey, onError]);

  const lastVisit = (r: CustomerRow) =>
    r.daysSinceLastVisit === 0 ? t("customers.today") : r.daysSinceLastVisit === 1 ? t("customers.yesterday") : t("customers.daysAgo", { count: r.daysSinceLastVisit });

  return (
    <section className="card span-8" id="customers">
      <div className="card-head">
        <h2 className="card-title">{t("customers.title")}</h2>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((v) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => props.onTab(v)}>
            {t(`customers.tab.${v}` as StringKey)}
          </button>
        ))}
      </div>
      {tab === "lapsed" && <p className="hint">{t("customers.lapsedHint")}</p>}
      <div className={loading && rows ? "refetching table-wrap" : "table-wrap"}>
        {rows && rows.length === 0 ? (
          <div className="empty">{t(`customers.empty.${tab}` as StringKey)}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("customers.col.name")}</th>
                <th className="num">{t("customers.col.spent")}</th>
                <th className="num">{t("customers.col.visits")}</th>
                <th>{t("customers.col.last")}</th>
                <th className="num">{t("customers.col.gap")}</th>
                {tab === "lapsed" && <th className="num">{t("customers.col.worth")}</th>}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.customerUid} className="clickable" tabIndex={0} onClick={() => setOpenUid(r.customerUid)} onKeyDown={(e) => e.key === "Enter" && setOpenUid(r.customerUid)}>
                  <td>{r.name ? iso(r.name) : t("customers.unknown")}</td>
                  <td className="num">{money(r.spend[currency] ?? 0, currency)}</td>
                  <td className="num">{count(r.visitDays)}</td>
                  <td>{lastVisit(r)}</td>
                  <td className="num">{gapText(r.usualGapDays)}</td>
                  {tab === "lapsed" && <td className="num">{money(r.monthlyValue[currency] ?? 0, currency)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openUid && <CustomerDrawer storeUid={storeUid} customerUid={openUid} currency={currency} lang={lang} onClose={() => setOpenUid(null)} />}
    </section>
  );
}

function CustomerDrawer(props: { storeUid: string; customerUid: string; currency: Currency; lang: string; onClose: () => void }) {
  const { t } = useI18n();
  const gapText = useGapText();
  const [data, setData] = useState<{ customer: CustomerRow; sales: CustomerSale[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getCustomer(props.storeUid, props.customerUid).then(setData).catch(() => setFailed(true));
  }, [props.storeUid, props.customerUid]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  const c = data?.customer;
  return (
    <>
      <div className="scrim" onClick={props.onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={c?.name ?? t("customers.unknown")}>
        <div className="card-head">
          <div style={{ flex: 1 }}>
            <h2 className="card-title">{c?.name ? iso(c.name) : t("customers.unknown")}</h2>
            {c && <p className="card-sub">{t("customers.since", { date: shortDate(c.firstSeenDay, props.lang) })}</p>}
          </div>
          <button className="ghost" onClick={props.onClose}>
            {t("customers.close")}
          </button>
        </div>
        {failed && <div className="empty">{t("error.generic")}</div>}
        {c && (
          <>
            <div className="stat-pairs">
              <div>
                <span>{t("customers.col.spent")}</span>
                <strong>{money(c.spend[props.currency] ?? 0, props.currency)}</strong>
              </div>
              <div>
                <span>{t("customers.col.visits")}</span>
                <strong>{count(c.visitDays)}</strong>
              </div>
              <div>
                <span>{t("customers.col.gap")}</span>
                <strong>{gapText(c.usualGapDays)}</strong>
              </div>
              <div>
                <span>{t("customers.col.worth")}</span>
                <strong>{money(c.monthlyValue[props.currency] ?? 0, props.currency)}</strong>
              </div>
            </div>
            {(c.refunded[props.currency] ?? 0) > 0 && <p className="hint">{t("customers.refunded", { amount: money(c.refunded[props.currency] ?? 0, props.currency) })}</p>}
            <h3 className="card-title" style={{ fontSize: 14, margin: "8px 0" }}>
              {t("customers.history")}
            </h3>
            <table>
              <tbody>
                {data!.sales.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {shortDate(localParts(s.atMs).day, props.lang)} {clock(s.atMs)}
                    </td>
                    <td className="num">{money(s.gross, s.currency)}</td>
                    <td>{s.refunded > 0 ? <span className="pill">{t("tx.refunded")}</span> : s.reference ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </aside>
    </>
  );
}

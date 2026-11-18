import { FormEvent, useState } from "react";
import { inviteStore, respondLink, unlinkStore } from "../api";
import { StringKey, useI18n } from "../i18n";
import { clock, count, iso, money, pct, shortDate } from "../lib/format";
import { StoreRow } from "../lib/stats";
import { localParts } from "../lib/time";
import { Currency, StoreLinks } from "../lib/types";

/** "All stores": each store's period side by side; a row opens that store. */
export function StoreComparison({ rows, currency, today, onPick }: { rows: StoreRow[]; currency: Currency; today: string; onPick: (uid: string) => void }) {
  const { t, lang } = useI18n();
  const last = (ms: number | null) => {
    if (!ms) return "–";
    const d = localParts(ms).day;
    return d === today ? clock(ms) : `${shortDate(d, lang)} ${clock(ms)}`;
  };
  return (
    <section className="card span-12" id="stores">
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2 className="card-title">{t("stores.compare.title")}</h2>
          <p className="card-sub">{t("stores.compare.subtitle")}</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("stores.col.store")}</th>
              <th className="num">{t("kpi.net")}</th>
              <th className="num">{t("kpi.sales")}</th>
              <th className="num">{t("kpi.average")}</th>
              <th className="num">{t("stores.col.change")}</th>
              <th>{t("stores.col.lastSale")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.storeUid} className="clickable" tabIndex={0} onClick={() => onPick(r.storeUid)} onKeyDown={(e) => e.key === "Enter" && onPick(r.storeUid)}>
                <td>{iso(r.name)}</td>
                <td className="num">{money(r.net, currency)}</td>
                <td className="num">{count(r.count)}</td>
                <td className="num">{money(r.averageSale, currency)}</td>
                <td className="num" style={{ color: r.change === null ? undefined : r.change < 0 ? "var(--down-bad)" : "var(--up-good)" }}>
                  {r.change === null ? "–" : pct(r.change)}
                </td>
                <td>{last(r.lastSaleAtMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A request from an owner to see this shop: accept, decline, or stop sharing. */
export function IncomingLink({ links, onChanged }: { links: StoreLinks; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const inc = links.incoming;
  if (!inc) return null;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card span-12 notice" style={{ marginBottom: 0 }}>
      {inc.status === "invited" ? (
        <>
          <h2 className="card-title">{t("stores.incoming.title", { owner: iso(inc.ownerName) })}</h2>
          <p className="card-sub" style={{ margin: "6px 0 12px" }}>
            {t("stores.incoming.body")}
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="primary" disabled={busy} onClick={() => act(() => respondLink(true))}>
              {t("stores.incoming.accept")}
            </button>
            <button className="ghost" disabled={busy} onClick={() => act(() => respondLink(false))}>
              {t("stores.incoming.decline")}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>{t("stores.incoming.linked", { owner: iso(inc.ownerName) })}</span>
          <button className="ghost" disabled={busy} onClick={() => act(() => unlinkStore())}>
            {t("stores.incoming.leave")}
          </button>
        </div>
      )}
    </section>
  );
}

/** Link more stores: by their Zapp number; they accept on their own Zapp Business. */
export function ManageStores({ links, onChanged }: { links: StoreLinks; onChanged: () => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // A shop linked to an owner can't link stores of its own.
  if (links.incoming?.status === "active") return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await inviteStore(phone);
      setMsg({ ok: true, text: t("stores.manage.sent", { store: iso(r.storeName) }) });
      setPhone("");
      onChanged();
    } catch (err) {
      const reason = (err as { details?: { reason?: string } })?.details?.reason ?? "";
      const key = (["link_no_shop", "link_taken"].includes(reason) ? `stores.error.${reason}` : "stores.error.other") as StringKey;
      setMsg({ ok: false, text: t(key) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (uid: string) => {
    setBusy(true);
    try {
      await unlinkStore(uid);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card span-12" id="manage-stores">
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2 className="card-title">{t("stores.manage.title")}</h2>
          <p className="card-sub">{t("stores.manage.intro")}</p>
        </div>
      </div>
      {links.linked.length === 0 ? (
        <p className="hint">{t("stores.manage.none")}</p>
      ) : (
        <ul className="feed">
          {links.linked.map((l) => (
            <li key={l.storeUid}>
              <div className="who">
                <div>{iso(l.storeName)}</div>
                <div className="when">{l.status === "active" ? t("stores.manage.linked") : t("stores.manage.waiting")}</div>
              </div>
              <button className="link" style={{ color: "var(--down-bad)" }} disabled={busy} onClick={() => remove(l.storeUid)}>
                {t("stores.manage.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <input
          className="ghost"
          style={{ flex: "1 1 220px", padding: "8px 12px" }}
          inputMode="tel"
          placeholder="063 000 0000"
          aria-label={t("stores.manage.phone")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button className="primary" disabled={busy || !phone.trim()}>
          {t("stores.manage.invite")}
        </button>
      </form>
      {msg && (
        <p className="hint" style={{ color: msg.ok ? "var(--up-good)" : "var(--down-bad)", marginTop: 8 }}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

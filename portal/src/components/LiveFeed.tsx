import { useEffect, useRef, useState } from "react";
import { StringKey, useI18n } from "../i18n";
import { clock, iso, ltr, moneyPlain } from "../lib/format";
import { Currency, RecentItem } from "../lib/types";

export function LiveFeed({ items, nowMs, currency }: { items: RecentItem[]; nowMs: number; currency: Currency }) {
  const { t } = useI18n();
  // Highlight what arrives while the page is open (not the first load), for a few seconds.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (items.length === 0 && seen.current === null) return;
    const arrived = seen.current ? items.filter((i) => !seen.current!.has(i.txId)).map((i) => i.txId) : [];
    seen.current = new Set(items.map((i) => i.txId));
    if (arrived.length === 0) return;
    setFresh((f) => new Set([...f, ...arrived]));
    const id = setTimeout(() => setFresh((f) => new Set([...f].filter((x) => !arrived.includes(x)))), 3000);
    return () => clearTimeout(id);
  }, [items]);
  const shown = items.filter((i) => i.currency === currency).slice(0, 12);
  const ago = (ms: number) => {
    const mins = Math.floor((nowMs - ms) / 60000);
    if (mins < 1) return t("live.justNow");
    if (mins < 60) return t("live.minutesAgo", { count: mins });
    return clock(ms);
  };
  return (
    <section className="card span-4" aria-live="polite">
      <div className="card-head">
        <h2 className="card-title">
          <span className="live-dot" style={{ marginInlineEnd: 8 }} />
          {t("live.title")}
        </h2>
      </div>
      {shown.length === 0 ? (
        <div className="empty">{t("live.empty")}</div>
      ) : (
        <ul className="feed">
          {shown.map((i) => (
            <li key={i.txId} className={fresh.has(i.txId) ? "fresh" : undefined}>
              <div className="who">
                <div>{i.customerName ? iso(i.customerName) : t("customers.unknown")}</div>
                <div className="when">
                  {ago(i.atMs)} · {i.type === "refund" ? t("live.refund") : i.channel ? t(`channel.${i.channel}` as StringKey) : ""}
                </div>
              </div>
              <div className={`amt${i.type === "refund" ? " refund" : ""}`}>
                {ltr(`${i.type === "refund" ? "−" : "+"}${moneyPlain(i.type === "refund" ? i.gross : i.net, i.currency)}`)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useState } from "react";
import { StringKey, useI18n } from "../i18n";
import { clock, hourLabel, iso, money, weekdayName } from "../lib/format";
import { Insight } from "../lib/insights";
import { localParts } from "../lib/time";
import { Currency } from "../lib/types";
import { AlertIcon, BulbIcon, CheckIcon, InfoIcon, PhoneIcon } from "./icons";

const DISMISSED = "zb.dismissed";

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Title and body for a card, in the reader's language and the shop's currency. */
function texts(i: Insight, t: (k: StringKey, p?: Record<string, string | number>) => string, lang: string, weekday: string) {
  const v = i.values;
  const amt = (n: number | string, c: number | string = "USD") => money(Number(n), c as Currency);
  switch (i.type) {
    case "quiet_till":
      return {
        title: Number(v.lastSaleAtMs) > 0 ? t("insight.quiet_till.title", { time: clock(Number(v.lastSaleAtMs)) }) : t("insight.quiet_till.titleNoSale"),
        body: t("insight.quiet_till.body", { weekday, expected: v.expected }),
        action: t("insight.quiet_till.action"),
      };
    case "display_offline":
      return {
        title: t("insight.display_offline.title", { name: iso(String(v.name)) }),
        body: Number(v.lastSeenAtMs) > 0 ? t("insight.display_offline.body", { time: clock(Number(v.lastSeenAtMs)) }) : t("insight.display_offline.bodyNever"),
        action: t("insight.display_offline.action"),
      };
    case "refund_spike":
      return {
        title: t("insight.refund_spike.title", { count: v.count, amount: amt(v.amount, v.currency) }),
        body: t("insight.refund_spike.body"),
        action: t("insight.refund_spike.action"),
      };
    case "pace_behind":
    case "pace_ahead":
      return {
        title: t(i.type === "pace_behind" ? "insight.pace_behind.title" : "insight.pace_ahead.title", {
          pct: `${Math.abs(Number(v.pct))}%`,
          weekday,
        }),
        body: t("insight.pace.body", { net: amt(v.net, v.currency), typical: amt(v.typicalNet, v.currency), weekday, weeks: v.weeks }),
        action: t("insight.pace.action"),
      };
    case "lapsed_regulars":
      return {
        title: t("insight.lapsed_regulars.title", { count: v.count }),
        body: v.top
          ? t("insight.lapsed_regulars.bodyTop", { value: amt(v.monthlyValue, v.currency), top: iso(String(v.top)) })
          : t("insight.lapsed_regulars.body", { value: amt(v.monthlyValue, v.currency) }),
        action: t("insight.lapsed_regulars.action"),
      };
    case "idle_balance":
      return {
        title: t("insight.idle_balance.title", { amount: amt(v.amount, v.currency) }),
        body: t("insight.idle_balance.body"),
        action: t("attention.onPhone"),
      };
    case "peak_hours": {
      const day = weekdayName(Number(v.weekday), lang);
      return {
        title: t("insight.peak_hours.title", { share: v.share, start: hourLabel(Number(v.start)), end: hourLabel(Number(v.end)) }),
        body:
          Number(v.quiet) >= 0
            ? t("insight.peak_hours.bodyQuiet", { weekday: day, quiet: hourLabel(Number(v.quiet)) })
            : t("insight.peak_hours.body", { weekday: day }),
        action: t("insight.peak_hours.action"),
      };
    }
  }
}

export function InsightCards(props: { insights: Insight[]; nowMs: number; onGoto: (target: string) => void }) {
  const { t, lang } = useI18n();
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [open, setOpen] = useState<string | null>(null);
  const weekday = weekdayName(localParts(props.nowMs).weekday, lang);
  const visible = props.insights.filter((i) => !dismissed.has(i.id));

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    // Ids carry the day, so keeping the last 200 is plenty.
    localStorage.setItem(DISMISSED, JSON.stringify([...next].slice(-200)));
    setDismissed(next);
  };

  return (
    <section className="card span-12" aria-labelledby="attention-title">
      <div className="card-head">
        <h2 className="card-title" id="attention-title">
          {t("attention.title")}
        </h2>
      </div>
      {visible.length === 0 ? (
        <div className="all-clear">
          <CheckIcon />
          {t("attention.allClear")}
        </div>
      ) : (
        <div className="insights">
          {visible.map((i) => {
            const x = texts(i, t, lang, weekday);
            const isOpen = open === i.id;
            return (
              <article key={i.id} className={`insight ${i.severity}`}>
                <span className="badge">
                  {i.severity === "urgent" ? <AlertIcon /> : i.severity === "opportunity" ? <BulbIcon /> : <InfoIcon />}
                  {t(`severity.${i.severity}` as StringKey)}
                </span>
                <h3>{x.title}</h3>
                <p>{x.body}</p>
                {isOpen && i.action.kind === "checklist" && (
                  <ol>
                    {i.action.steps.map((s) => (
                      <li key={s}>{t(s as StringKey)}</li>
                    ))}
                  </ol>
                )}
                {isOpen && i.action.kind === "phone" && (
                  <div className="phone-where">{t(i.action.where as StringKey)}</div>
                )}
                <div className="insight-actions">
                  {i.action.kind === "goto" ? (
                    <button className="link" onClick={() => props.onGoto((i.action as { target: string }).target)}>
                      {x.action} →
                    </button>
                  ) : (
                    <button className="link" onClick={() => setOpen(isOpen ? null : i.id)} aria-expanded={isOpen}>
                      {i.action.kind === "phone" && <PhoneIcon />} {isOpen ? t("attention.hide") : x.action}
                    </button>
                  )}
                  <span className="spacer" />
                  <button className="link" style={{ color: "var(--muted)", fontWeight: 500 }} onClick={() => dismiss(i.id)}>
                    {t("attention.dismiss")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}


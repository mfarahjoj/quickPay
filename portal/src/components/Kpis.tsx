import { ReactNode } from "react";
import { useI18n } from "../i18n";
import { count, money, moneyShort, pct, weekdayName } from "../lib/format";
import { change, Period, PERIOD_DAYS, Summary } from "../lib/stats";
import { Currency } from "../lib/types";
import { Sparkline } from "./charts";

function Delta({ value, upIsGood = true, note }: { value: number | null; upIsGood?: boolean; note: string }) {
  const { t } = useI18n();
  if (value === null) return <span className="delta flat"><span className="delta-note">{t("kpi.noCompare")}</span></span>;
  const good = value === 0 ? "flat" : value > 0 === upIsGood ? "good" : "bad";
  return (
    <span className={`delta ${good}`}>
      <span aria-hidden="true">{value > 0 ? "▲" : value < 0 ? "▼" : "•"}</span>
      {pct(value)} <span className="delta-note">{note}</span>
    </span>
  );
}

function Tile(props: { label: string; value: string; sub?: ReactNode; delta?: ReactNode; trend?: number[]; hero?: boolean }) {
  return (
    <div className={`card tile${props.hero ? " hero" : ""}`}>
      <div className="tile-label">{props.label}</div>
      <div className="tile-row">
        <div className="tile-value">{props.value}</div>
        {props.trend && <Sparkline values={props.trend} />}
      </div>
      {props.delta && <div>{props.delta}</div>}
      {props.sub && <div className="tile-sub">{props.sub}</div>}
    </div>
  );
}

export function Kpis(props: {
  summary: Summary;
  period: Period;
  currency: Currency;
  weekday: number;
  uniqueCustomers: number | null;
  trend: number[];
  agent: boolean;
}) {
  const { t, lang } = useI18n();
  const { summary: s, currency: c, period } = props;
  const note = period === "today" ? t("kpi.vsToday", { weekday: weekdayName(props.weekday, lang) }) : t("kpi.vsPeriod", { days: PERIOD_DAYS[period] });
  const returningShare = s.current.visits ? Math.round((s.current.returningVisits / s.current.visits) * 100) : 0;
  const prevReturningShare = s.previous.visits ? Math.round((s.previous.returningVisits / s.previous.visits) * 100) : 0;
  return (
    <div className="kpis">
      <Tile
        hero
        label={t("kpi.net")}
        value={moneyShort(s.current.net, c)}
        delta={<Delta value={change(s.current.net, s.previous.net)} note={note} />}
        sub={t("kpi.netSub", { gross: money(s.current.gross, c), fee: money(s.current.fee, c) })}
        trend={props.trend}
      />
      <Tile label={t("kpi.sales")} value={count(s.current.count)} delta={<Delta value={change(s.current.count, s.previous.count)} note={note} />} />
      <Tile
        label={t("kpi.average")}
        value={money(s.averageSale, c)}
        delta={<Delta value={change(s.averageSale, s.previousAverageSale)} note={note} />}
      />
      <Tile
        label={t("kpi.customers")}
        value={props.uniqueCustomers === null ? "–" : count(props.uniqueCustomers)}
        sub={t("kpi.customersSub", { count: count(s.current.newCustomers) })}
      />
      <Tile
        label={t("kpi.returning")}
        value={s.current.visits ? `${returningShare}%` : "–"}
        sub={t("kpi.returningSub")}
        delta={s.current.visits && s.previous.visits ? <Delta value={returningShare - prevReturningShare} note={note} /> : undefined}
      />
      <Tile
        label={t("kpi.refunds")}
        value={money(s.current.refundGross, c)}
        sub={t("kpi.refundsSub", { count: count(s.current.refundCount) })}
        delta={<Delta value={change(s.current.refundGross, s.previous.refundGross)} upIsGood={false} note={note} />}
      />
      {props.agent && (
        <Tile
          label={t("kpi.commission")}
          value={money(s.current.commission, c)}
          sub={t("kpi.commissionSub", { in: count(s.current.cashInCount), out: count(s.current.cashOutCount) })}
          delta={<Delta value={change(s.current.commission, s.previous.commission)} note={note} />}
        />
      )}
    </div>
  );
}

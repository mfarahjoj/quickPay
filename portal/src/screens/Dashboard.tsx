import { useCallback, useEffect, useMemo, useState } from "react";
import { countCustomersSince, getCustomers, getStore, isSessionEnded, watchDays, watchRecent } from "../api";
import { ChartCard, ColumnPoint, ColumnsChart, Heatmap, HBars, Legend, StackedColumns } from "../components/charts";
import { Customers } from "../components/Customers";
import { InsightCards } from "../components/InsightCards";
import { Kpis } from "../components/Kpis";
import { LiveFeed } from "../components/LiveFeed";
import { Transactions, TxFilter } from "../components/Transactions";
import { LANGS, Lang, StringKey, useI18n } from "../i18n";
import { clock, count, hourLabel, money, moneyShort, shortDate, weekdayName } from "../lib/format";
import { computeInsights } from "../lib/insights";
import {
  channelMix,
  customerSeries,
  DayMap,
  dailySeries,
  heatmap,
  HISTORY_DAYS,
  hourly,
  isAgent,
  lastSaleAt,
  Period,
  PERIOD_DAYS,
  summarize,
  totals,
  typicalDay,
  usesCurrency,
  windowsFor,
} from "../lib/stats";
import { addDays, dayRange, dayStartMs, localParts } from "../lib/time";
import { CustomerRow, CustomerView, Currency, PortalStore, RecentItem } from "../lib/types";

type Theme = "auto" | "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("zb.theme") as Theme) || "auto");
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("zb.theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"))];
}

function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function Dashboard({ onSessionEnded, onSignOut }: { onSessionEnded: () => void; onSignOut: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [theme, cycleTheme] = useTheme();
  const nowMs = useNow();
  const { day: today, hour, minute, weekday } = localParts(nowMs);

  const [store, setStore] = useState<PortalStore | null>(null);
  const [days, setDays] = useState<DayMap>(new Map());
  const [daysLoaded, setDaysLoaded] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [lapsed, setLapsed] = useState<CustomerRow[] | null>(null);
  const [unique, setUnique] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>("today");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [customerTab, setCustomerTab] = useState<CustomerView>("top");
  const [txFilter, setTxFilter] = useState<TxFilter>("all");

  const fail = useCallback(
    (e: unknown) => {
      if (isSessionEnded(e)) onSessionEnded();
      else console.error(e);
    },
    [onSessionEnded]
  );

  const shop = store?.stores[0] ?? null;
  const storeUid = shop?.storeUid ?? null;

  // Who the shop is, balances and displays: now and every two minutes.
  useEffect(() => {
    let live = true;
    const load = () => getStore().then((s) => live && setStore(s)).catch(fail);
    load();
    const id = setInterval(load, 120_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [fail]);

  // The day docs and the live feed, as they change.
  const fromDay = addDays(today, -(HISTORY_DAYS - 1));
  useEffect(() => {
    if (!storeUid) return;
    const offDays = watchDays(
      storeUid,
      fromDay,
      (docs) => {
        setDays(new Map(docs.map((d) => [d.period, d])));
        setDaysLoaded(true);
      },
      fail
    );
    const offRecent = watchRecent(storeUid, setRecent, fail);
    return () => {
      offDays();
      offRecent();
    };
  }, [storeUid, fromDay, fail]);

  const lastSale = lastSaleAt(days);
  const windows = windowsFor(today, period);

  // Distinct customers in the period, exact: everyone last seen inside it.
  useEffect(() => {
    if (!storeUid) return;
    countCustomersSince(storeUid, dayStartMs(windows.current[0]))
      .then(setUnique)
      .catch(fail);
  }, [storeUid, windows.current[0], lastSale, fail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regulars gone quiet, for the attention card: on load and every ten minutes.
  useEffect(() => {
    if (!storeUid) return;
    let live = true;
    const load = () => getCustomers(storeUid, "lapsed", currency, 50).then((r) => live && setLapsed(r.customers)).catch(fail);
    load();
    const id = setInterval(load, 600_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [storeUid, currency, fail]);

  const showShillings = usesCurrency(days, "SLS") || (shop?.balances.SLS ?? 0) > 0;
  useEffect(() => {
    if (!showShillings && currency === "SLS") setCurrency("USD");
  }, [showShillings, currency]);

  const summary = useMemo(() => summarize(days, today, hour, period, currency), [days, today, hour, period, currency]);
  const insights = useMemo(
    () => computeInsights({ days, today, hour, minute, nowMs, currency, store: shop, lapsed, lastSaleAtMs: lastSale }),
    [days, today, hour, minute, nowMs, currency, shop, lapsed, lastSale]
  );
  const trend = useMemo(() => dailySeries(days, dayRange(today, 12), currency).map((p) => p.net), [days, today, currency]);
  const agent = isAgent(days) || shop?.accountType === "agent_merchant";

  const goto = (target: string) => {
    if (target === "hourly") setPeriod("today");
    if (target === "customers:lapsed") setCustomerTab("lapsed");
    if (target === "transactions:refunds") setTxFilter("refunds");
    const id = target === "hourly" ? "trend" : target.split(":")[0];
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const fmt = (v: number) => money(v, currency);
  const axis = (v: number) => moneyShort(v, currency);
  const weekdayLong = weekdayName(weekday, lang);

  // Trend: today by the hour against a typical same weekday, or day by day against the period before.
  let trendCard: JSX.Element;
  if (period === "today") {
    const typical = typicalDay(days, today, currency);
    const now = hourly(days, today, currency);
    const useTypical = typical.weeks >= 2;
    const active = now.count.map((c, h) => c > 0 || (useTypical && typical.count[h] > 0));
    const first = Math.max(0, Math.min(active.indexOf(true) === -1 ? 8 : active.indexOf(true), hour) - 1);
    const last = Math.min(23, Math.max(active.lastIndexOf(true), hour) + 1);
    const data: ColumnPoint[] = [];
    for (let h = first; h <= last; h++) {
      data.push({ key: String(h), axisLabel: hourLabel(h), title: hourLabel(h), value: now.net[h], ...(useTypical ? { compare: typical.net[h] } : {}) });
    }
    const typicalLabel = t("chart.hourly.typical", { weekday: weekdayLong });
    trendCard = (
      <ChartCard
        id="trend"
        className="span-8"
        title={t("chart.hourly.title")}
        subtitle={useTypical ? t("chart.hourly.subtitle", { weekday: weekdayLong, weeks: typical.weeks }) : t("chart.hourly.subtitleNoTypical")}
        legend={
          useTypical ? (
            <Legend
              items={[
                { label: t("chart.hourly.today"), color: "var(--series-1)", kind: "rect" },
                { label: typicalLabel, color: "var(--compare)", kind: "line" },
              ]}
            />
          ) : undefined
        }
        empty={daysLoaded && data.every((d) => !d.value && !d.compare)}
        dim={!daysLoaded}
        table={{
          head: [t("col.hour"), t("chart.hourly.today"), ...(useTypical ? [typicalLabel] : [])],
          rows: data.map((d) => [d.axisLabel, fmt(d.value), ...(useTypical ? [fmt(d.compare ?? 0)] : [])]),
          numeric: [1, 2],
        }}
      >
        <ColumnsChart data={data} valueLabel={t("chart.hourly.today")} compareLabel={useTypical ? typicalLabel : undefined} format={fmt} axisFormat={axis} highlightKey={String(hour)} />
      </ChartCard>
    );
  } else {
    const cur = dailySeries(days, windows.current, currency);
    const prev = dailySeries(days, windows.previous, currency);
    const data: ColumnPoint[] = cur.map((p, i) => ({
      key: p.day,
      axisLabel: shortDate(p.day, lang),
      title: `${weekdayName(localParts(dayStartMs(p.day) + 3600_000).weekday, lang, "short")} ${shortDate(p.day, lang)}`,
      value: p.net,
      compare: prev[i]?.net ?? 0,
    }));
    trendCard = (
      <ChartCard
        id="trend"
        className="span-8"
        title={t("chart.daily.title")}
        subtitle={t("chart.daily.subtitle", { days: PERIOD_DAYS[period] })}
        legend={
          <Legend
            items={[
              { label: t("chart.daily.current"), color: "var(--series-1)", kind: "rect" },
              { label: t("chart.daily.previous"), color: "var(--compare)", kind: "line" },
            ]}
          />
        }
        empty={daysLoaded && data.every((d) => !d.value && !d.compare)}
        dim={!daysLoaded}
        table={{
          head: [t("col.day"), t("chart.daily.current"), t("chart.daily.previous")],
          rows: data.map((d, i) => [d.title, fmt(d.value), `${shortDate(prev[i].day, lang)}: ${fmt(d.compare ?? 0)}`]),
          numeric: [1],
        }}
      >
        <ColumnsChart data={data} valueLabel={t("chart.daily.current")} compareLabel={t("chart.daily.previous")} format={fmt} axisFormat={axis} />
      </ChartCard>
    );
  }

  // One day says nothing about busy hours: on Today the map shows the last four weeks (and says so).
  const heatDays = period === "today" ? dayRange(today, 28) : windows.current;
  const grid = heatmap(days, heatDays, currency);
  const rowLabels = Array.from({ length: 7 }, (_, w) => weekdayName(w, lang, "short"));
  const mix = channelMix(totals(days, windows.current, currency));
  const customerDays = period === "today" ? dayRange(today, 7) : windows.current;
  const custSeries = customerSeries(days, customerDays);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src="/icon.svg" alt="" />
            <span className="hint" style={{ fontWeight: 600 }}>
              {t("brand")}
            </span>
          </div>
          <div className="shop">
            <span className="shop-name">{shop?.name ?? "…"}</span>
            <span className="shop-meta">
              <span className="live-dot" aria-hidden="true" />
              {lastSale ? t("header.lastSale", { time: localParts(lastSale).day === today ? clock(lastSale) : `${shortDate(localParts(lastSale).day, lang)} ${clock(lastSale)}` }) : t("header.noSales")}
              {shop?.area ? <span>· {shop.area}</span> : null}
            </span>
          </div>
          <span className="spacer" />
          {shop && (
            <div className="shop" style={{ textAlign: "end" }}>
              <span className="hint">{t("header.wallet")}</span>
              <strong>
                {money(shop.balances.USD, "USD")}
                {shop.balances.SLS > 0 ? ` · ${money(shop.balances.SLS, "SLS")}` : ""}
              </strong>
            </div>
          )}
          {shop && shop.displays.length > 0 && (
            <div className="shop" title={t("store.displays")}>
              <span className="hint">{t("store.displays")}</span>
              <span style={{ display: "flex", gap: 6 }}>
                {shop.displays.map((d) => (
                  <span key={d.name} className="pill" style={{ color: d.online ? "var(--up-good)" : "var(--down-bad)" }}>
                    {d.online ? "●" : "○"} {d.name} · {d.online ? t("store.online") : t("store.offline")}
                  </span>
                ))}
              </span>
            </div>
          )}
          <select className="ghost" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("header.language")}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={cycleTheme} aria-label={t("header.theme")} title={t("header.theme")}>
            {theme === "auto" ? "◐" : theme === "light" ? "☀" : "☾"}
          </button>
          <button className="ghost" onClick={onSignOut}>
            {t("header.signOut")}
          </button>
        </div>
      </header>

      <main className="wrap">
        <div className="filters">
          <div className="seg" role="group">
            {(["today", "7d", "30d", "90d"] as Period[]).map((p) => (
              <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                {t(`period.${p}` as StringKey)}
              </button>
            ))}
          </div>
          {showShillings && (
            <div className="seg" role="group">
              {(["USD", "SLS"] as Currency[]).map((c) => (
                <button key={c} aria-pressed={currency === c} onClick={() => setCurrency(c)}>
                  {t(`currency.${c}` as StringKey)}
                </button>
              ))}
            </div>
          )}
          <span className="hint">{t("header.hargeisaTime")}</span>
        </div>

        <div className="grid">
          <InsightCards insights={insights} nowMs={nowMs} onGoto={goto} />
          <div className="span-12">
            <Kpis summary={summary} period={period} currency={currency} weekday={weekday} uniqueCustomers={unique} trend={trend} agent={agent} />
          </div>

          {trendCard}
          <LiveFeed items={recent} nowMs={nowMs} currency={currency} />

          <ChartCard
            id="heatmap"
            className="span-8"
            title={t("chart.heatmap.title")}
            subtitle={t("chart.heatmap.subtitle", { from: shortDate(heatDays[0], lang), to: shortDate(heatDays[heatDays.length - 1], lang) })}
            empty={daysLoaded && grid.flat().every((v) => v === 0)}
            dim={!daysLoaded}
            table={{
              head: [t("col.weekday"), ...Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"))],
              rows: grid.map((row, w) => [rowLabels[w], ...row]),
            }}
          >
            <Heatmap
              grid={grid}
              rowLabels={rowLabels}
              fewer={t("chart.heatmap.fewer")}
              more={t("chart.heatmap.more")}
              cellTitle={(w, h, v) => `${weekdayName(w, lang)} ${hourLabel(h)}: ${t("chart.heatmap.sales", { count: count(v) })}`}
            />
          </ChartCard>

          <ChartCard
            className="span-4"
            title={t("chart.channels.title")}
            subtitle={t("chart.channels.subtitle")}
            empty={daysLoaded && mix.length === 0}
            dim={!daysLoaded}
            table={{
              head: [t("col.channel"), t("col.share"), t("col.net"), t("col.count")],
              rows: mix.map((m) => [t(`channel.${m.channel}` as StringKey), `${m.share}%`, fmt(m.net), m.count]),
              numeric: [1, 2, 3],
            }}
          >
            <HBars rows={mix.map((m) => ({ key: m.channel, label: t(`channel.${m.channel}` as StringKey), share: m.share, value: axis(m.net) }))} />
          </ChartCard>

          {storeUid && (
            <Customers storeUid={storeUid} currency={currency} tab={customerTab} onTab={setCustomerTab} refreshKey={lastSale ?? 0} onError={fail} />
          )}

          <ChartCard
            className="span-4"
            title={t("chart.customers.title")}
            subtitle={`${t("chart.customers.subtitle")} · ${shortDate(customerDays[0], lang)}–${shortDate(customerDays[customerDays.length - 1], lang)}`}
            legend={
              <Legend
                items={[
                  { label: t("chart.customers.returning"), color: "var(--series-1)", kind: "rect" },
                  { label: t("chart.customers.new"), color: "var(--series-2)", kind: "rect" },
                ]}
              />
            }
            empty={daysLoaded && custSeries.every((p) => !p.new && !p.returning)}
            dim={!daysLoaded}
            table={{
              head: [t("col.day"), t("chart.customers.returning"), t("chart.customers.new")],
              rows: custSeries.map((p) => [shortDate(p.day, lang), p.returning, p.new]),
              numeric: [1, 2],
            }}
          >
            <StackedColumns
              data={custSeries.map((p) => ({ key: p.day, axisLabel: shortDate(p.day, lang), title: shortDate(p.day, lang), a: p.returning, b: p.new }))}
              aLabel={t("chart.customers.returning")}
              bLabel={t("chart.customers.new")}
            />
          </ChartCard>

          {storeUid && <Transactions storeUid={storeUid} filter={txFilter} onFilter={setTxFilter} refreshKey={lastSale ?? 0} onError={fail} today={today} />}
        </div>

        {store && (
          <p className="footer">
            {t("footer.session", {
              browser: store.session.browser,
              time: `${localParts(store.session.expiresAtMs).day === today ? "" : shortDate(localParts(store.session.expiresAtMs).day, lang) + " "}${clock(store.session.expiresAtMs)}`,
            })}
          </p>
        )}
      </main>
    </>
  );
}

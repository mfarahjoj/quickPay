/**
 * The dashboard's charts, in plain SVG (dataviz skill: thin marks, 4px
 * rounded data ends square at the baseline, 2px surface gaps, hairline grid,
 * a tooltip on every mark, a table view for every chart). Charts stay left to
 * right in Arabic too: time and hours read that way on every clock.
 */
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(240, entries[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** 0 and up to four clean steps above the max. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 3;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  // Up to and including the first tick at or above the max, so no mark
  // ever rises past the top gridline.
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1e6) / 1e6);
  return ticks;
}

/** A bar with 4px rounded data end, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

interface TipRow {
  color: string;
  kind: "rect" | "line";
  label: string;
  value: string;
}

function Tooltip({ x, y, title, rows, width }: { x: number; y: number; title: string; rows: TipRow[]; width: number }) {
  const left = Math.min(Math.max(0, x + 12), width - 180);
  return (
    <div className="tooltip" style={{ left, top: Math.max(0, y - 10) }} role="status">
      <div className="tt-title">{title}</div>
      {rows.map((r) => (
        <div className="tt-row" key={r.label}>
          <span
            className={r.kind === "line" ? "key-line" : "key-rect"}
            style={{ background: r.color, width: r.kind === "line" ? 12 : 8, height: r.kind === "line" ? 2 : 8 }}
          />
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; kind: "rect" | "line" }> }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <span className={i.kind === "line" ? "key-line" : "key-rect"} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface ColumnPoint {
  key: string;
  axisLabel: string;
  title: string;
  value: number;
  compare?: number;
}

/**
 * Columns for the period, a gray line for what they're compared with, on one
 * axis (never two). The column under the pointer or focus shows both values.
 */
export function ColumnsChart(props: {
  data: ColumnPoint[];
  valueLabel: string;
  compareLabel?: string;
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  height?: number;
  highlightKey?: string;
}) {
  const { data, format, axisFormat, valueLabel, compareLabel } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = props.height ?? 220;
  const m = { top: 8, right: 8, bottom: 24, left: 52 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.compare ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band - 2, band * 0.7));
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const cx = (i: number) => m.left + band * i + band / 2;
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 52))));
  const hasCompare = data.some((d) => d.compare !== undefined);
  const line = hasCompare ? data.map((d, i) => `${i ? "L" : "M"}${cx(i)},${y(d.compare ?? 0)}`).join("") : "";

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setActive(null)}>
      <svg height={height} role="img" aria-label={valueLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="axis-text">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <path
            key={d.key}
            d={barPath(cx(i) - barW / 2, y(d.value), barW, y(0) - y(d.value))}
            fill="var(--series-1)"
            opacity={active === null || active === i ? 1 : 0.55}
          />
        ))}
        {hasCompare && <path d={line} fill="none" stroke="var(--compare)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {props.highlightKey &&
          data.map((d, i) =>
            d.key === props.highlightKey ? (
              <line key="now" x1={cx(i)} x2={cx(i)} y1={m.top} y2={y(0)} stroke="var(--axis)" strokeWidth={1} />
            ) : null
          )}
        {data.map((d, i) =>
          i % every === 0 ? (
            <text key={`x${d.key}`} x={cx(i)} y={height - 6} textAnchor="middle" className="axis-text">
              {d.axisLabel}
            </text>
          ) : null
        )}
        {data.map((d, i) => (
          <rect
            key={`hit${d.key}`}
            x={m.left + band * i}
            y={m.top}
            width={band}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            aria-label={`${d.title}: ${format(d.value)}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
      </svg>
      {active !== null && data[active] && (
        <Tooltip
          x={cx(active)}
          y={y(Math.max(data[active].value, data[active].compare ?? 0))}
          width={width}
          title={data[active].title}
          rows={[
            { color: "var(--series-1)", kind: "rect", label: valueLabel, value: format(data[active].value) },
            ...(hasCompare && compareLabel
              ? [{ color: "var(--compare)", kind: "line" as const, label: compareLabel, value: format(data[active].compare ?? 0) }]
              : []),
          ]}
        />
      )}
    </div>
  );
}

/** Two series stacked, a 2px surface gap between them. */
export function StackedColumns(props: {
  data: Array<{ key: string; axisLabel: string; title: string; a: number; b: number }>;
  aLabel: string;
  bLabel: string;
  height?: number;
}) {
  const { data, aLabel, bLabel } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = props.height ?? 180;
  const m = { top: 8, right: 8, bottom: 24, left: 36 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const ticks = niceTicks(Math.max(1, ...data.map((d) => d.a + d.b)));
  const top = ticks[ticks.length - 1] || 1;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band - 2, band * 0.7));
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const cx = (i: number) => m.left + band * i + band / 2;
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 52))));

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setActive(null)}>
      <svg height={height} role="img" aria-label={`${aLabel}, ${bLabel}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} />
            <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="axis-text">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = cx(i) - barW / 2;
          const aTop = y(d.a);
          const gap = d.a > 0 && d.b > 0 ? 2 : 0;
          const bH = y(0) - y(d.b);
          return (
            <g key={d.key} opacity={active === null || active === i ? 1 : 0.55}>
              {d.a > 0 && <path d={d.b > 0 ? `M${x},${y(0)}V${aTop}H${x + barW}V${y(0)}Z` : barPath(x, aTop, barW, y(0) - aTop)} fill="var(--series-1)" />}
              {d.b > 0 && <path d={barPath(x, aTop - gap - bH, barW, bH)} fill="var(--series-2)" />}
            </g>
          );
        })}
        {data.map((d, i) =>
          i % every === 0 ? (
            <text key={`x${d.key}`} x={cx(i)} y={height - 6} textAnchor="middle" className="axis-text">
              {d.axisLabel}
            </text>
          ) : null
        )}
        {data.map((d, i) => (
          <rect
            key={`hit${d.key}`}
            x={m.left + band * i}
            y={m.top}
            width={band}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            aria-label={`${d.title}: ${aLabel} ${d.a}, ${bLabel} ${d.b}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
      </svg>
      {active !== null && data[active] && (
        <Tooltip
          x={cx(active)}
          y={y(data[active].a + data[active].b)}
          width={width}
          title={data[active].title}
          rows={[
            { color: "var(--series-1)", kind: "rect", label: aLabel, value: String(data[active].a) },
            { color: "var(--series-2)", kind: "rect", label: bLabel, value: String(data[active].b) },
          ]}
        />
      )}
    </div>
  );
}

/** A 12-point trend in the comparison gray, the latest point in the accent. */
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = (width - 6) / (values.length - 1);
  const pts = values.map((v, i) => [3 + i * step, height - 4 - (v / max) * (height - 8)]);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ direction: "ltr" }}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--compare)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

const SEQ = ["--seq-0", "--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"];

/** Weekday × hour, one blue ramp, more is stronger. */
export function Heatmap(props: { grid: number[][]; rowLabels: string[]; cellTitle: (row: number, hour: number, value: number) => string; fewer: string; more: string }) {
  const { grid, rowLabels } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<[number, number] | null>(null);
  const labelW = 44;
  const gap = 2;
  const cell = Math.max(8, Math.min(28, (width - labelW) / 24 - gap));
  const max = Math.max(1, ...grid.flat());
  const level = (v: number) => (v <= 0 ? 0 : Math.min(7, 1 + Math.floor((v / max) * 6.999)));
  const h = 7 * (cell + gap) + 22;
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setActive(null)}>
      <svg height={h} role="img" aria-label={`${props.fewer} – ${props.more}`}>
        {grid.map((row, r) => (
          <g key={r}>
            <text x={labelW - 8} y={r * (cell + gap) + cell / 2 + 4} textAnchor="end" className="axis-text">
              {rowLabels[r]}
            </text>
            {row.map((v, hr) => (
              <rect
                key={hr}
                x={labelW + hr * (cell + gap)}
                y={r * (cell + gap)}
                width={cell}
                height={cell}
                rx={3}
                fill={`var(${SEQ[level(v)]})`}
                stroke={active && active[0] === r && active[1] === hr ? "var(--text)" : "none"}
                strokeWidth={1.5}
                tabIndex={0}
                aria-label={props.cellTitle(r, hr, v)}
                onMouseEnter={() => setActive([r, hr])}
                onFocus={() => setActive([r, hr])}
                onBlur={() => setActive(null)}
              />
            ))}
          </g>
        ))}
        {Array.from({ length: 8 }, (_, i) => i * 3).map((hr) => (
          <text key={hr} x={labelW + hr * (cell + gap) + cell / 2} y={h - 6} textAnchor="middle" className="axis-text">
            {String(hr).padStart(2, "0")}
          </text>
        ))}
      </svg>
      <div className="legend" style={{ marginTop: 8 }}>
        <span>{props.fewer}</span>
        <span style={{ gap: 2 }}>
          {SEQ.slice(1).map((s) => (
            <span key={s} className="key-rect" style={{ background: `var(${s})` }} />
          ))}
        </span>
        <span>{props.more}</span>
      </div>
      {active && (
        <Tooltip
          x={labelW + active[1] * (cell + gap)}
          y={active[0] * (cell + gap)}
          width={width}
          title={props.cellTitle(active[0], active[1], grid[active[0]][active[1]])}
          rows={[]}
        />
      )}
    </div>
  );
}

/** Ranked horizontal bars, one hue, the value at the tip. */
export function HBars({ rows }: { rows: Array<{ key: string; label: string; share: number; value: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.share));
  return (
    <div>
      {rows.map((r) => (
        <div className="hbar-row" key={r.key}>
          <div className="hbar-label">{r.label}</div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(r.share / max) * 70}%` }} />
            <span className="hbar-value">
              {r.share}% · {r.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A chart with its title, legend, and a table view a click away. */
export function ChartCard(props: {
  id?: string;
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  table: { head: string[]; rows: Array<Array<string | number>>; numeric?: number[] };
  empty?: boolean;
  emptyText?: string;
  className?: string;
  dim?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  useEffect(() => setAsTable(false), [props.title]);
  return (
    <section className={`card ${props.className ?? ""}`} id={props.id}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2 className="card-title">{props.title}</h2>
          {props.subtitle && <p className="card-sub">{props.subtitle}</p>}
        </div>
        {!props.empty && (
          <button className="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? t("chart.chart") : t("chart.table")}
          </button>
        )}
      </div>
      <div className={props.dim ? "refetching" : undefined}>
        {props.empty ? (
          <div className="empty">{props.emptyText ?? t("chart.empty")}</div>
        ) : asTable ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {props.table.head.map((h, i) => (
                    <th key={h} className={props.table.numeric?.includes(i) ? "num" : undefined}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {props.table.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, i) => (
                      <td key={i} className={props.table.numeric?.includes(i) ? "num" : undefined}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            {props.legend}
            {props.children}
          </>
        )}
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type RateRow } from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { Loading } from "./ui";

/** What an admin types, for a stored value: percent for rates, dollars for cents. */
function toInput(row: RateRow): string {
  const v = row.value;
  if (row.spec.kind === "rate") return String(Math.round((v as number) * 10000) / 100);
  if (row.spec.kind === "cents") return ((v as number) / 100).toFixed(2);
  return String(v);
}

/** The stored value for what was typed, or undefined if it isn't valid. */
function fromInput(row: RateRow, text: string): number | string | undefined {
  const spec = row.spec;
  if (spec.kind === "enum") return spec.options.some((o) => o.value === text) ? text : undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || text.trim() === "") return undefined;
  if (spec.kind === "rate") {
    const v = Math.round(n * 100) / 10000;
    return v >= 0 && v <= spec.max ? v : undefined;
  }
  const v = spec.kind === "cents" ? Math.round(n * 100) : n;
  return Number.isInteger(v) && v >= spec.min && v <= spec.max ? v : undefined;
}

function display(row: RateRow, value: number | string): string {
  const spec = row.spec;
  if (spec.kind === "rate") return `${Math.round((value as number) * 10000) / 100}%`;
  if (spec.kind === "cents") return `$${((value as number) / 100).toFixed(2)}`;
  if (spec.kind === "enum") return spec.options.find((o) => o.value === value)?.label ?? String(value);
  return `${value} ${spec.unit ?? ""}`.trim();
}

function range(row: RateRow): string {
  const spec = row.spec;
  if (spec.kind === "rate") return `0–${spec.max * 100}%`;
  if (spec.kind === "cents") return `$${(spec.min / 100).toFixed(2)}–$${(spec.max / 100).toFixed(2)}`;
  if (spec.kind === "int") return `${spec.min}–${spec.max} ${spec.unit ?? ""}`.trim();
  return "";
}

/**
 * Pricing & rules (decisions D1, D3): every fee, commission and rule in
 * config/rates, grouped, with its default and allowed range. Super admins
 * edit; everyone else reads. Saving takes a reason and lands in the audit
 * log; the backend refuses anything out of range.
 */
export function PricingPanel({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getRates();
      setRows(res.rows);
      setDraft({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const out = new Map<string, RateRow[]>();
    rows.forEach((r) => out.set(r.spec.group, [...(out.get(r.spec.group) ?? []), r]));
    return [...out.entries()];
  }, [rows]);

  // Only fields whose typed value differs from what's in force.
  const changes = useMemo(() => {
    const out: Record<string, number | string> = {};
    for (const row of rows) {
      if (!(row.key in draft)) continue;
      const v = fromInput(row, draft[row.key]);
      if (v !== undefined && v !== row.value) out[row.key] = v;
    }
    return out;
  }, [draft, rows]);
  const invalid = rows.filter((r) => r.key in draft && fromInput(r, draft[r.key]) === undefined).map((r) => r.key);

  const save = async (reason: string) => {
    const res = await api.updateRates(changes, reason);
    setSaving(false);
    setNotice(`Saved ${res.changed.length} change${res.changed.length === 1 ? "" : "s"}. Every server picks them up within 5 minutes.`);
    await load();
  };

  if (loading)
    return (
      <div className="panel">
        <Loading />
      </div>
    );

  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}
      {error && <div className="banner error">{error}</div>}
      {!canEdit && (
        <div className="banner">Only super admins can change prices and rules. You can see what's in force.</div>
      )}

      {groups.map(([group, groupRows]) => (
        <div className="panel" key={group}>
          <div className="panel-head">
            <h2>{group}</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wide">Setting</th>
                  <th>In force</th>
                  <th>{canEdit ? "Change to" : "Default"}</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row) => (
                  <tr key={row.key}>
                    <td className="wide">
                      <strong>{row.spec.label}</strong>
                      <div className="hint">{row.spec.help}</div>
                    </td>
                    <td className="nowrap">
                      {display(row, row.value)}
                      {!row.overridden && <div className="muted">default</div>}
                    </td>
                    <td className="nowrap">
                      {!canEdit ? (
                        display(row, row.spec.default)
                      ) : row.spec.kind === "enum" ? (
                        <select
                          value={draft[row.key] ?? String(row.value)}
                          onChange={(e) => setDraft({ ...draft, [row.key]: e.target.value })}
                          aria-label={row.spec.label}
                        >
                          {row.spec.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <input
                            inputMode="decimal"
                            style={{ width: 110 }}
                            value={draft[row.key] ?? toInput(row)}
                            onChange={(e) => setDraft({ ...draft, [row.key]: e.target.value })}
                            aria-label={row.spec.label}
                            aria-invalid={invalid.includes(row.key)}
                          />
                          <span className="muted"> {row.spec.kind === "rate" ? "%" : row.spec.kind === "cents" ? "$" : row.spec.unit}</span>
                          <div className="hint" style={{ color: invalid.includes(row.key) ? "var(--danger)" : undefined }}>
                            {range(row)} · default {display(row, row.spec.default)}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {canEdit && (
        <div className="row">
          <button
            className="primary"
            disabled={Object.keys(changes).length === 0 || invalid.length > 0}
            onClick={() => setSaving(true)}
          >
            <Icon name="check" size={16} />
            Save {Object.keys(changes).length || ""} change{Object.keys(changes).length === 1 ? "" : "s"}
          </button>
          <button className="ghost" onClick={() => setDraft({})} disabled={Object.keys(draft).length === 0}>
            Discard
          </button>
        </div>
      )}

      {saving && (
        <ReasonPrompt
          title="Change prices and rules"
          description={Object.entries(changes)
            .map(([k, v]) => {
              const row = rows.find((r) => r.key === k)!;
              return `${row.spec.label}: ${display(row, row.value)} → ${display(row, v)}`;
            })
            .join(" · ")}
          confirmLabel="Save"
          onConfirm={save}
          onCancel={() => setSaving(false)}
        />
      )}
    </div>
  );
}

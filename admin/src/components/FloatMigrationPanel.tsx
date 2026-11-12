import { useState } from "react";
import { api, type FloatMigrationRow } from "../api";
import { ReasonPrompt } from "./ReasonPrompt";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * One-off: split agents' float out of their wallets
 * (AGENT_FLOAT_SEPARATION.md). Preview first, adjust any agent whose
 * computed float doesn't match what they really hold, then a super admin
 * applies it. Each agent can only be migrated once, so a second run does
 * nothing. Run it straight after deploying the split.
 */
export function FloatMigrationPanel({ isSuper, onApplied }: { isSuper: boolean; onApplied: () => Promise<void> }) {
  const [rows, setRows] = useState<FloatMigrationRow[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState<"preview" | "apply" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const overrideCents = () =>
    Object.fromEntries(
      Object.entries(overrides)
        .filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)))
        .map(([k, v]) => [k, Math.round(Number(v) * 100)])
    );

  const run = async (reason: string) => {
    const apply = prompt === "apply";
    const res = await api.migrateAgentFloat(apply, reason, overrideCents());
    setRows(res.rows);
    setPrompt(null);
    if (apply) {
      const moved = res.rows.filter((r) => r.alreadyMigrated).length;
      setNotice(`Float separated for ${moved} agent${moved === 1 ? "" : "s"}.`);
      await onApplied();
    }
  };

  const pending = rows?.filter((r) => !r.alreadyMigrated) ?? [];
  if (rows && pending.length === 0 && !notice) return null;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Separate agent float from wallets</h2>
      </div>
      <p className="hint">
        One-off, after the float split is deployed. Each agent's float is worked out from their journal (issued −
        withdrawn − cashed in + cashed out, without commission) and moved into their float account. Until then their
        cash-ins are refused for lack of float.
      </p>
      {notice && <div className="banner ok">{notice}</div>}

      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="wide">Agent</th>
                <th className="num">Journal float</th>
                <th className="num">Wallet now</th>
                <th className="num">Will move</th>
                <th>Adjust ($)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.agentId}>
                  <td className="wide">
                    {r.fullName || r.agentId}
                    {r.alreadyMigrated && <div className="muted">done</div>}
                    {r.shortfallCents > 0 && !r.alreadyMigrated && (
                      <div className="muted" style={{ color: "var(--warn)" }}>
                        {money(r.shortfallCents)} more float than the wallet holds; check with the agent
                      </div>
                    )}
                  </td>
                  <td className="num">{money(r.computedCents)}</td>
                  <td className="num">{money(r.walletCents)}</td>
                  <td className="num">{money(r.moveCents)}</td>
                  <td>
                    {!r.alreadyMigrated && (
                      <input
                        inputMode="decimal"
                        style={{ width: 90 }}
                        placeholder={(r.moveCents / 100).toFixed(2)}
                        value={overrides[r.agentId] ?? ""}
                        onChange={(e) => setOverrides({ ...overrides, [r.agentId]: e.target.value })}
                        aria-label={`Amount to move for ${r.fullName || r.agentId}`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => setPrompt("preview")}>{rows ? "Preview again" : "Preview"}</button>
        {isSuper && rows && pending.length > 0 && (
          <button className="primary" onClick={() => setPrompt("apply")}>
            Apply to {pending.length} agent{pending.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {!isSuper && rows && <p className="hint">A super admin applies it.</p>}

      {prompt && (
        <ReasonPrompt
          title={prompt === "apply" ? "Separate float for these agents" : "Preview the float split"}
          description={
            prompt === "apply"
              ? "Posts one entry per agent moving the amount shown (or your adjustment) from their wallet to their float account. Nothing more than the wallet holds is moved."
              : "Nothing is posted. Adjustments you've typed are included in the preview."
          }
          confirmLabel={prompt === "apply" ? "Apply" : "Preview"}
          onConfirm={run}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}

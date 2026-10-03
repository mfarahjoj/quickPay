import { useCallback, useEffect, useId, useState } from "react";
import {
  api,
  type LedgerAlertDetail,
  type LedgerDriftRow,
  type LedgerOverview,
  type LedgerRun,
  type LedgerTrace,
  type LedgerTraceRow,
} from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { Avatar, EmptyState, Loading } from "./ui";

type Ts = { _seconds?: number; seconds?: number } | null | undefined;

function when(ts: Ts) {
  const secs = ts?._seconds ?? ts?.seconds;
  return secs
    ? new Date(secs * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

/** Cents → "$1,284.50", "−$12.00", or "+$3.00" when `signed`. */
function cents(value: number | null | undefined, signed = false) {
  if (value === null || value === undefined) return "—";
  const abs = (Math.abs(value) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value < 0) return `−$${abs}`;
  return `${signed && value > 0 ? "+" : ""}$${abs}`;
}

const n = (value: number) => value.toLocaleString();

function plural(count: number, one: string, many: string) {
  return `${n(count)} ${count === 1 ? one : many}`;
}

function statusTone(status: string | null) {
  if (status === "completed" || status === "success") return "ok";
  if (status === "pending") return "warn";
  if (status === "failed" || status === "rejected") return "bad";
  return "";
}

function Tile({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "bad" | "warn";
  small?: boolean;
}) {
  return (
    <div className={`tile${tone ? ` ${tone}` : ""}`}>
      <div className="tile-label">{label}</div>
      <div className={`tile-value${small ? " small" : ""}`}>{value}</div>
      {sub ? <div className="tile-sub">{sub}</div> : null}
    </div>
  );
}

function RunBadge({ run }: { run: LedgerRun }) {
  if (run.driftCount > 0) {
    return (
      <span className="badge closed keep-case">
        {plural(run.driftCount, "mismatch", "mismatches")}
      </span>
    );
  }
  if (!run.spendIndexOk) return <span className="badge closed keep-case">Spend index down</span>;
  return <span className="badge active keep-case">Clean</span>;
}

function JournalBadge({ row }: { row: LedgerTraceRow }) {
  if (row.link === "posted") return <span className="badge active keep-case">In journal</span>;
  const settled = row.status === "completed" || row.status === "success";
  // Pending and failed transactions are expected to have no entry.
  if (!settled) return <span className="badge keep-case">Not posted</span>;
  return (
    <span className="badge closed keep-case">
      {row.link === "entry-missing" ? "Entry missing" : "No entry"}
    </span>
  );
}

/**
 * Trace one customer wallet: the mismatch the check found, and every recent
 * transaction marked by whether it reached the journal.
 */
function TraceSheet({ drift, onClose }: { drift: LedgerDriftRow; onClose: () => void }) {
  const [trace, setTrace] = useState<LedgerTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    let live = true;
    api
      .traceLedgerAccount(drift.account)
      .then((t) => live && setTrace(t))
      .catch((err) => live && setError(err instanceof Error ? err.message : "Trace failed"));
    return () => {
      live = false;
    };
  }, [drift.account]);

  // Read-only, so Escape can close it (the action prompts deliberately can't).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = drift.user?.fullName || "(no name)";

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal wide">
        <div className="modal-head">
          <div className="person-head">
            <Avatar name={drift.user?.fullName ?? undefined} size={44} />
            <div className="person-text">
              <h2 id={titleId}>{name}</h2>
              <div className="sub mono">{drift.account}</div>
            </div>
          </div>
          <div className="spacer" />
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="tiles compact">
          <Tile label="Journal says" value={cents(drift.expected)} sub="at the check" />
          <Tile label="Wallet held" value={cents(drift.actual)} sub="at the check" />
          <Tile
            label="Difference"
            value={cents(drift.difference, true)}
            tone={drift.difference ? "bad" : undefined}
          />
          <Tile
            label="Wallet now"
            value={cents(trace?.wallet ? trace.wallet.balance : drift.currentBalance)}
            sub={trace?.wallet?.frozen ? "frozen" : undefined}
          />
        </div>

        {error ? (
          <div className="banner error">{error}</div>
        ) : !trace ? (
          <Loading label="Tracing transactions…" />
        ) : (
          <>
            {trace.summary.completedUnposted > 0 ? (
              <div className="banner warn">
                <strong>
                  {plural(trace.summary.completedUnposted, "completed transaction", "completed transactions")}{" "}
                  never reached the journal
                </strong>{" "}
                ({cents(trace.summary.completedUnpostedAmount)} in total). They moved money
                outside the ledger and are the likely cause of this mismatch.
              </div>
            ) : (
              <div className="banner ok">
                Every completed transaction below has a journal entry, so the gap is
                elsewhere: an older transaction beyond these {trace.transactions.length}, a
                journal entry with no transaction record (adjustment, float, payout), or a
                lost projection write.
              </div>
            )}

            {trace.transactions.length === 0 ? (
              <EmptyState icon="inbox" title="No transactions for this wallet" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Type</th>
                      <th className="wide">Description</th>
                      <th>Status</th>
                      <th className="num">Amount</th>
                      <th className="num">Wallet effect</th>
                      <th>Journal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.transactions.map((t) => (
                      <tr key={t.id}>
                        <td className="muted nowrap">{when(t.createdAt)}</td>
                        <td className="nowrap">{t.type ?? "—"}</td>
                        <td className="wide">{t.description || "—"}</td>
                        <td>
                          {t.status ? (
                            <span className={`badge ${statusTone(t.status)}`}>{t.status}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num">
                          {t.amount === null
                            ? "—"
                            : t.direction === "out"
                              ? cents(-t.amount)
                              : cents(t.amount, t.direction === "in")}
                        </td>
                        <td className="num">{cents(t.walletEffect, true)}</td>
                        <td className="nowrap">
                          <JournalBadge row={t} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {trace.truncated && (
              <p className="hint" style={{ marginTop: 10 }}>
                Showing the latest {trace.transactions.length} transactions.
              </p>
            )}
          </>
        )}

        <p className="hint" style={{ marginTop: 16 }}>
          To correct a balance, post an <code>adjustment</code> journal entry. Never edit a
          wallet directly: its balance is a projection of the journal, and the next check
          would flag the edit as drift.
        </p>
        <div className="actions">
          <button className="ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** What one run found: the mismatch table, acknowledgement, and tracing. */
function AlertView({
  alertId,
  onChanged,
}: {
  alertId: string;
  onChanged: (message: string) => void;
}) {
  const [detail, setDetail] = useState<LedgerAlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [tracing, setTracing] = useState<LedgerDriftRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getLedgerAlert(alertId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this check");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    void load();
  }, [load]);

  const closeTrace = useCallback(() => setTracing(null), []);

  const acknowledge = async (reason: string) => {
    await api.acknowledgeLedgerAlert(alertId, reason);
    setAcknowledging(false);
    onChanged(
      "Alert acknowledged. The drift stays until a correction is posted and a check comes back clean."
    );
    await load();
  };

  if (loading)
    return (
      <div className="panel">
        <Loading />
      </div>
    );
  if (error) return <div className="banner error">{error}</div>;
  if (!detail) return null;

  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="panel-head">
          <h2>Check of {when(detail.ranAt)}</h2>
          <div className="spacer" />
          {detail.acknowledged ? (
            <span className="badge active keep-case">Acknowledged</span>
          ) : (
            <button onClick={() => setAcknowledging(true)}>Acknowledge</button>
          )}
        </div>
        {detail.acknowledged && (
          <p className="hint">
            By {detail.acknowledgedByEmail ?? "an admin"} on {when(detail.acknowledgedAt)}
            {detail.acknowledgeReason ? `: “${detail.acknowledgeReason}”` : ""}
          </p>
        )}

        {!detail.spendIndexOk && (
          <div className="banner error" style={{ marginTop: 14 }}>
            <strong>The spend index was down during this check.</strong>{" "}
            {detail.spendIndexError ?? ""}
          </div>
        )}

        {detail.drifts.length === 0 ? (
          <EmptyState icon="check" title="No balance mismatches in this check" />
        ) : (
          <>
            <p className="hint" style={{ marginTop: 6 }}>
              <strong>Journal</strong> is what the double-entry journal says the balance
              should be; <strong>Cached</strong> is what the wallet or ledger balance held.
              A positive difference means the cached balance holds value the journal can’t
              explain.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="wide">Account and issue</th>
                    <th className="num">Journal</th>
                    <th className="num">Cached</th>
                    <th className="num">Difference</th>
                    <th className="num">Now</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.drifts.map((d, i) => (
                    <tr key={`${d.account}-${i}`}>
                      <td className="wide">
                        <div className="drift-who">
                          {d.user ? (
                            <>
                              {d.user.fullName || "(no name)"}{" "}
                              <span className="muted mono">{d.account}</span>
                            </>
                          ) : (
                            <span className="mono">{d.account}</span>
                          )}
                        </div>
                        <div className="muted drift-issue">{d.detail}</div>
                      </td>
                      <td className="num">{cents(d.expected)}</td>
                      <td className="num">{cents(d.actual)}</td>
                      <td className={`num${d.difference ? " diff" : ""}`}>
                        {cents(d.difference, true)}
                      </td>
                      <td className="num muted">{cents(d.currentBalance)}</td>
                      <td className="actions">
                        {d.user && <button onClick={() => setTracing(d)}>Trace</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.driftCount > detail.shownCount && (
              <p className="hint" style={{ marginTop: 10 }}>
                Showing the first {n(detail.shownCount)} of {n(detail.driftCount)}. The check
                stores at most 100 per run.
              </p>
            )}
          </>
        )}
      </div>

      {acknowledging && (
        <ReasonPrompt
          title="Acknowledge this alert"
          description="Marks the alert as seen and owned, and takes it off the open-alert count. The drift itself stays until a correction is posted and a check comes back clean."
          confirmLabel="Acknowledge"
          onConfirm={acknowledge}
          onCancel={() => setAcknowledging(false)}
        />
      )}

      {tracing && <TraceSheet drift={tracing} onClose={closeTrace} />}
    </div>
  );
}

function firstToOpen(data: LedgerOverview) {
  const open = new Set(data.alerts.filter((a) => !a.acknowledged).map((a) => a.id));
  return (data.runs.find((r) => open.has(r.id)) ?? data.runs[0])?.id;
}

/**
 * Ledger reconciliation.
 *
 * Reads what the invariant check recorded — it never computes balances in the
 * browser — and offers the two actions an operator needs: acknowledge an
 * alert, and re-run the check after posting a correction.
 */
export function LedgerDesk() {
  const [overview, setOverview] = useState<LedgerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [running, setRunning] = useState(false);

  const load = useCallback(async (select?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.ledgerOverview();
      setOverview(data);
      setSelected((prev) => select ?? prev ?? firstToOpen(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the ledger desk");
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = async (reason: string) => {
    const res = await api.runLedgerCheck(reason);
    setRunning(false);
    setNotice(
      res.driftCount === 0 && res.spendIndexOk
        ? `Check finished: ${n(res.entryCount)} entries, zero drift.`
        : `Check finished: ${plural(res.driftCount, "mismatch", "mismatches")} across ${n(res.entryCount)} entries.`
    );
    await load(res.runId);
  };

  const latest = overview?.runs[0];
  const alertIds = new Set(overview?.alerts.map((a) => a.id) ?? []);
  const acknowledged = new Set(
    overview?.alerts.filter((a) => a.acknowledged).map((a) => a.id) ?? []
  );
  const selectedRun = overview?.runs.find((r) => r.id === selected);

  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>Latest check</h2>
          {latest && <RunBadge run={latest} />}
          <div className="spacer" />
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" size={16} />
            Refresh
          </button>
          <button className="primary" onClick={() => setRunning(true)} disabled={loading}>
            Run check now
          </button>
        </div>

        {loading && !overview ? (
          <Loading />
        ) : !overview ? null : !latest ? (
          <EmptyState icon="ledger" title="The check has never run">
            Nothing is verifying balances against the journal yet. Run it now, or wait for
            the nightly job.
          </EmptyState>
        ) : (
          <div className="tiles">
            <Tile
              label="Ran"
              value={when(latest.ranAt)}
              small
              sub={
                latest.trigger === "manual"
                  ? `Manual${latest.triggeredBy ? ` · ${latest.triggeredBy}` : ""}`
                  : "Nightly, 03:00 Hargeisa"
              }
            />
            <Tile label="Journal entries" value={n(latest.entryCount)} />
            <Tile label="Accounts" value={n(latest.accountCount)} />
            <Tile
              label="Mismatches"
              value={n(latest.driftCount)}
              tone={latest.driftCount > 0 ? "bad" : "ok"}
            />
            <Tile
              label="Spend index"
              value={latest.spendIndexOk ? "Healthy" : "Down"}
              tone={latest.spendIndexOk ? "ok" : "bad"}
            />
            <Tile
              label="Open alerts"
              value={n(overview.openAlertCount)}
              tone={overview.openAlertCount > 0 ? "warn" : undefined}
            />
          </div>
        )}
      </div>

      {overview && overview.runs.length > 0 && (
        <div className="split">
          <div className="panel">
            <div className="panel-head">
              <h2>Recent checks</h2>
            </div>
            <p className="hint">Nightly at 03:00 Hargeisa time, plus manual runs. Newest first.</p>
            <div className="list">
              {overview.runs.map((run) => {
                const bad = run.driftCount > 0 || !run.spendIndexOk;
                return (
                  <button
                    key={run.id}
                    className={`item${run.id === selected ? " selected" : ""}`}
                    onClick={() => setSelected(run.id)}
                  >
                    <span className={`status-disc ${bad ? "bad" : "ok"}`} aria-hidden="true">
                      <Icon name={bad ? "alert" : "check"} size={18} />
                    </span>
                    <div className="item-text">
                      <div className="name">{when(run.ranAt)}</div>
                      <div className="sub">
                        <RunBadge run={run} /> {run.trigger === "manual" ? "Manual" : "Nightly"}
                        {acknowledged.has(run.id) ? " · acknowledged" : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {!selectedRun ? (
            <div className="panel">
              <EmptyState icon="ledger" title="No check selected">
                Pick a check to see what it found.
              </EmptyState>
            </div>
          ) : selectedRun.driftCount > 0 || !selectedRun.spendIndexOk || alertIds.has(selectedRun.id) ? (
            <AlertView
              key={selectedRun.id}
              alertId={selectedRun.id}
              onChanged={(message) => {
                setNotice(message);
                void load();
              }}
            />
          ) : (
            <div className="panel">
              <EmptyState icon="check" title="No mismatches in this check">
                {n(selectedRun.entryCount)} journal entries and {n(selectedRun.accountCount)}{" "}
                accounts all matched their cached balances.
              </EmptyState>
            </div>
          )}
        </div>
      )}

      {running && (
        <ReasonPrompt
          title="Run the ledger check now"
          description="Replays the whole journal and compares every balance, exactly like the nightly job. It can take a minute, and it adds a run to the history."
          confirmLabel="Run check"
          onConfirm={runCheck}
          onCancel={() => setRunning(false)}
        />
      )}
    </div>
  );
}

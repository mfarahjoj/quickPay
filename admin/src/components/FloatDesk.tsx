import { useCallback, useEffect, useState } from "react";
import { api, type AgentPosition, type FloatIssuanceRow } from "../api";
import { FloatRequestModal } from "./FloatRequestModal";
import { ReasonPrompt } from "./ReasonPrompt";

interface Decision {
  row: FloatIssuanceRow;
  action: "approve" | "reject";
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const LOW_FLOAT_CENTS = 5000; // $50 — an agent below this can barely serve anyone

export function FloatDesk({ adminUid }: { adminUid: string }) {
  const [agents, setAgents] = useState<AgentPosition[]>([]);
  const [queue, setQueue] = useState<FloatIssuanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<AgentPosition | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [positions, pending] = await Promise.all([
        api.listAgentFloat(),
        api.listFloatIssuances("pending"),
      ]);
      setAgents(positions);
      setQueue(pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the float desk");
      setAgents([]);
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (reason: string) => {
    if (!decision) return;
    if (decision.action === "approve") {
      await api.approveFloat(decision.row.issuanceId, reason);
      setNotice(
        `Posted ${money(decision.row.amountCents)} ${decision.row.direction} for ${
          decision.row.agentName || decision.row.agentId
        }.`
      );
    } else {
      await api.rejectFloat(decision.row.issuanceId, reason);
      setNotice("Request rejected. Nothing was posted.");
    }
    setDecision(null);
    await load();
  };

  return (
    <div>
      {notice && <div className="banner ok">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Pending float requests</h2>
          <div className="spacer" />
          <button className="ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : error ? null : queue.length === 0 ? (
          <div className="empty">Nothing waiting.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Direction</th>
                <th>Route</th>
                <th>Reference</th>
                <th>Requested by</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.map((r) => {
                // Maker-checker: the backend refuses this, but showing it
                // disabled explains why rather than failing on click.
                const blocked = r.requiresSecondApprover && r.requestedBy === adminUid;
                return (
                  <tr key={r.issuanceId}>
                    <td>{r.agentName || r.agentId}</td>
                    <td>{r.direction}</td>
                    <td>{r.route}</td>
                    <td className="muted">{r.externalReference || "—"}</td>
                    <td className="muted">
                      {r.requestedByEmail}
                      {r.requiresSecondApprover && (
                        <span className="badge frozen" style={{ marginLeft: 6 }}>
                          2nd approver
                        </span>
                      )}
                    </td>
                    <td className="num">{money(r.amountCents)}</td>
                    <td>
                      <div className="row">
                        <button
                          className="primary"
                          disabled={blocked}
                          title={
                            blocked
                              ? "You raised this request; it needs a different admin"
                              : undefined
                          }
                          onClick={() => setDecision({ row: r, action: "approve" })}
                        >
                          Approve
                        </button>
                        <button
                          className="danger"
                          onClick={() => setDecision({ row: r, action: "reject" })}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Agent float positions</h2>
        <p className="muted" style={{ fontSize: 12 }}>
          Lowest first. An agent with no float cannot cash customers in.
        </p>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : error ? null : agents.length === 0 ? (
          <div className="empty">No agents yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Phone</th>
                <th>Role</th>
                <th className="num">Float</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.agentId}>
                  <td>
                    {a.fullName || "(no name)"}
                    {a.accountStatus !== "active" && (
                      <span className="badge frozen" style={{ marginLeft: 6 }}>
                        {a.accountStatus}
                      </span>
                    )}
                  </td>
                  <td className="muted">{a.phoneNumber || "—"}</td>
                  <td className="muted">{a.accountType}</td>
                  <td
                    className="num"
                    style={
                      a.balanceCents < LOW_FLOAT_CENTS
                        ? { color: "var(--warn)" }
                        : undefined
                    }
                  >
                    {money(a.balanceCents)}
                  </td>
                  <td>
                    <button
                      onClick={() => setRequesting(a)}
                      disabled={a.accountStatus !== "active"}
                    >
                      Issue / withdraw
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {requesting && (
        <FloatRequestModal
          agent={requesting}
          onCancel={() => setRequesting(null)}
          onDone={async (message) => {
            setNotice(message);
            setRequesting(null);
            await load();
          }}
        />
      )}

      {decision && (
        <ReasonPrompt
          title={
            decision.action === "approve"
              ? `Approve ${money(decision.row.amountCents)} ${decision.row.direction}`
              : "Reject this request"
          }
          description={
            decision.action === "approve"
              ? `This posts to the ledger immediately and ${
                  decision.row.direction === "issue" ? "credits" : "debits"
                } ${decision.row.agentName || decision.row.agentId}. It cannot be edited afterwards — corrections are new entries.`
              : "Nothing is posted. The requester can raise a new request."
          }
          confirmLabel={decision.action === "approve" ? "Approve and post" : "Reject"}
          danger={decision.action === "reject"}
          onConfirm={decide}
          onCancel={() => setDecision(null)}
        />
      )}
    </div>
  );
}

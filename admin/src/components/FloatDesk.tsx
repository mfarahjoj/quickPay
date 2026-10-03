import { useCallback, useEffect, useState } from "react";
import { api, type AgentPosition, type FloatIssuanceRow } from "../api";
import { FloatRequestModal } from "./FloatRequestModal";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { EmptyState, Loading } from "./ui";

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
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>Pending float requests</h2>
          {!loading && !error && <span className="badge">{queue.length}</span>}
          <div className="spacer" />
          <button className="ghost" onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            Refresh
          </button>
        </div>

        {loading ? (
          <Loading />
        ) : error ? null : queue.length === 0 ? (
          <EmptyState icon="banknote" title="Nothing waiting" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wide">Agent</th>
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
                      <td className="wide">{r.agentName || r.agentId}</td>
                      <td>{r.direction}</td>
                      <td>{r.route}</td>
                      <td className="muted">{r.externalReference || "—"}</td>
                      <td className="muted">
                        {r.requestedByEmail}
                        {r.requiresSecondApprover && (
                          <span className="badge frozen" style={{ marginLeft: 8 }}>
                            2nd approver
                          </span>
                        )}
                      </td>
                      <td className="num">{money(r.amountCents)}</td>
                      <td className="actions">
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
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Agent float positions</h2>
        </div>
        <p className="hint">Lowest first. An agent with no float cannot cash customers in.</p>

        {loading ? (
          <Loading />
        ) : error ? null : agents.length === 0 ? (
          <EmptyState icon="user" title="No agents yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wide">Agent</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th className="num">Float</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const low = a.balanceCents < LOW_FLOAT_CENTS;
                  return (
                    <tr key={a.agentId}>
                      <td className="wide">
                        {a.fullName || "(no name)"}
                        {a.accountStatus !== "active" && (
                          <span className="badge frozen" style={{ marginLeft: 8 }}>
                            {a.accountStatus}
                          </span>
                        )}
                      </td>
                      <td className="muted nowrap">{a.phoneNumber || "—"}</td>
                      <td className="muted">{a.accountType}</td>
                      <td
                        className="num"
                        style={low ? { color: "var(--warn)" } : undefined}
                      >
                        {/* Colour alone is not a signal everyone can see. */}
                        {low && (
                          <span className="badge warn" style={{ marginRight: 8 }}>
                            Low
                          </span>
                        )}
                        {money(a.balanceCents)}
                      </td>
                      <td className="actions">
                        <button
                          onClick={() => setRequesting(a)}
                          disabled={a.accountStatus !== "active"}
                        >
                          Issue / withdraw
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

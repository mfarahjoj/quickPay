import { useCallback, useEffect, useState } from "react";
import { api, type RoleRequestRow } from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { EmptyState, Loading } from "./ui";

interface Pending {
  request: RoleRequestRow;
  decision: "approve" | "reject";
}

export function RoleQueue() {
  const [rows, setRows] = useState<RoleRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listRoleRequests("pending"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the queue");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (reason: string) => {
    if (!pending) return;
    await api.reviewRoleRequest(pending.request.requestId, pending.decision, reason);
    setNotice(
      `${pending.request.applicantName || pending.request.userId} — ${
        pending.decision === "approve" ? "approved" : "rejected"
      }.`
    );
    setPending(null);
    await load();
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Pending applications</h2>
        {!loading && !error && <span className="badge">{rows.length}</span>}
        <div className="spacer" />
        <button className="ghost" onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          Refresh
        </button>
      </div>

      <p className="hint">
        Approving grants the role and creates the merchant profile. Rejecting an
        account that already holds the role demotes it to customer.
      </p>

      {notice && <div className="banner ok">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <Loading />
      ) : error ? null : rows.length === 0 ? (
        // Only claim the queue is empty when we actually know it is — an
        // errored load must not read as "nothing to do".
        <EmptyState icon="briefcase" title="Nothing waiting for review" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Phone</th>
                <th>Requested</th>
                <th>Currently</th>
                <th className="wide">Business</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.requestId}>
                  <td>
                    {r.applicantName || "(no name)"}
                    {r.backfilled && (
                      <span className="badge frozen" style={{ marginLeft: 8 }}>
                        existing
                      </span>
                    )}
                  </td>
                  <td className="muted nowrap">{r.applicantPhone || "—"}</td>
                  <td>{r.requestedRole}</td>
                  <td className="muted">{r.currentAccountType || "customer"}</td>
                  <td className="muted wide">{r.businessName || r.area || "—"}</td>
                  <td className="actions">
                    <div className="row">
                      <button
                        className="primary"
                        onClick={() => setPending({ request: r, decision: "approve" })}
                      >
                        Approve
                      </button>
                      <button
                        className="danger"
                        onClick={() => setPending({ request: r, decision: "reject" })}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <ReasonPrompt
          title={
            pending.decision === "approve"
              ? `Approve ${pending.request.requestedRole}`
              : `Reject ${pending.request.requestedRole}`
          }
          description={
            pending.decision === "approve"
              ? `${
                  pending.request.applicantName || pending.request.userId
                } will be able to accept payments or issue float straight away.`
              : pending.request.currentAccountType === pending.request.requestedRole
                ? "This account already holds the role — rejecting will demote it to customer. The reason is shown to the applicant."
                : "The reason is shown to the applicant."
          }
          confirmLabel={pending.decision === "approve" ? "Approve" : "Reject"}
          danger={pending.decision === "reject"}
          onConfirm={decide}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

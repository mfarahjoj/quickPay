import { useCallback, useEffect, useState } from "react";
import { api, type RoleRequestRow } from "../api";
import { Icon } from "./Icon";
import { RoleApplicationView } from "./RoleApplicationView";
import { Avatar, EmptyState, Loading } from "./ui";

const ROLE_LABEL: Record<string, string> = {
  merchant: "Merchant",
  topup_agent: "Agent",
  agent_merchant: "Shop + agent",
};

/**
 * Merchant and agent applications. Pick one to see the whole application
 * (photos, business, payout, agent details, ID) and decide it once: approval
 * sets everything up.
 */
export function RoleQueue() {
  const [rows, setRows] = useState<RoleRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listRoleRequests("pending");
      // Ready to decide first, then those still filling in the form.
      list.sort((a, b) => Number(!!b.applicationSubmitted) - Number(!!a.applicationSubmitted));
      setRows(list);
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

  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}

      <div className="split">
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

          {error && <div className="banner error">{error}</div>}

          {loading ? (
            <Loading />
          ) : error ? null : rows.length === 0 ? (
            // Only claim the queue is empty when we actually know it is.
            <EmptyState icon="briefcase" title="Nothing waiting for review" />
          ) : (
            <div className="list">
              {rows.map((r) => (
                <button
                  key={r.requestId}
                  className={`item${r.requestId === selected ? " selected" : ""}`}
                  onClick={() => setSelected(r.requestId)}
                >
                  <Avatar name={r.applicantName} />
                  <div className="item-text">
                    <div className="row">
                      <span className="name">{r.businessName || r.applicantName || "(no name)"}</span>
                      <div className="spacer" />
                      {r.applicationSubmitted ? (
                        <span className="badge ok">ready</span>
                      ) : r.backfilled ? (
                        <span className="badge frozen">existing</span>
                      ) : (
                        <span className="badge">filling in</span>
                      )}
                    </div>
                    <div className="sub">
                      {ROLE_LABEL[r.requestedRole] ?? r.requestedRole} · {r.applicantName || "—"} ·{" "}
                      {r.applicantPhone || "(no phone)"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <p className="hint" style={{ marginTop: 10 }}>
            "Filling in" means they picked a role but haven't sent the full application from the app yet.
          </p>
        </div>

        <div className="panel">
          {selected ? (
            <RoleApplicationView
              key={selected}
              requestId={selected}
              onDecided={async (message) => {
                setNotice(message);
                setSelected(undefined);
                await load();
              }}
            />
          ) : (
            <EmptyState icon="briefcase" title="No application selected">
              Pick an application to see the photos, business, payout and ID, and decide it.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

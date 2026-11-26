import { useCallback, useEffect, useState } from "react";
import { api, type LiveAccessRequestRow } from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { AccountLink } from "./AccountLink";
import { EmptyState, Loading } from "./ui";

const ROLE_LABEL: Record<string, string> = {
  merchant: "Shop",
  agent_merchant: "Shop + agent",
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

/**
 * Shops asking for live API access (functions/src/admin/liveAccess.ts).
 *
 * Approving lets the owner make live keys in the merchant app with their PIN.
 * Before approving, talk to the shop: who is building the integration, and
 * that Zapp will never ask them for a key. Declining tells the shop why;
 * they can ask again. Withdrawing is on the account's API keys panel.
 */
export function ApiAccessDesk() {
  const [rows, setRows] = useState<LiveAccessRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState<LiveAccessRequestRow | null>(null);
  const [declining, setDeclining] = useState<LiveAccessRequestRow | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listLiveAccessRequests());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the requests");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const name = (r: LiveAccessRequestRow) => r.businessName || r.phoneNumber || r.merchantId;

  const approve = async (reason: string) => {
    if (!approving) return;
    await api.decideLiveAccess(approving.merchantId, "approve", reason);
    setNotice(`${name(approving)} can now make live keys. They've been told.`);
    setApproving(null);
    await load();
  };

  const decline = async (reason: string) => {
    if (!declining) return;
    await api.decideLiveAccess(declining.merchantId, "decline", reason, note.trim());
    setNotice(`Declined ${name(declining)}. They've been told and can ask again.`);
    setDeclining(null);
    setNote("");
    await load();
  };

  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>Waiting for a decision</h2>
          {!loading && !error && <span className="badge">{rows.length}</span>}
          <div className="spacer" />
          <button className="ghost" onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            Refresh
          </button>
        </div>

        {loading ? (
          <Loading />
        ) : error ? null : rows.length === 0 ? (
          <EmptyState icon="briefcase" title="No shop is waiting for live API access" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="wide">Shop</th>
                  <th className="wide">What it's for (their words)</th>
                  <th>Asked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.merchantId}>
                    <td className="wide">
                      <AccountLink uid={row.merchantId}>{name(row)}</AccountLink>
                      <div className="muted">
                        {[
                          row.accountType ? ROLE_LABEL[row.accountType] ?? row.accountType : null,
                          row.phoneNumber,
                          row.accountStatus && row.accountStatus !== "active" ? row.accountStatus : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="muted">
                        {row.activeTestKeys > 0
                          ? `${row.activeTestKeys} test key${row.activeTestKeys === 1 ? "" : "s"}: they've started building`
                          : "no test keys yet"}
                      </div>
                    </td>
                    <td className="wide">{row.purpose}</td>
                    <td className="nowrap">{when(row.requestedAt)}</td>
                    <td className="actions">
                      <div className="row">
                        <button onClick={() => setApproving(row)}>Approve</button>
                        <button
                          className="ghost"
                          onClick={() => {
                            setNote("");
                            setDeclining(row);
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {approving && (
        <ReasonPrompt
          title={`Approve live API access for ${name(approving)}`}
          description="The owner will be able to make live keys with their PIN (up to 5). Approve only after speaking to the shop: who is building the integration, and that Zapp will never ask them for a key. Note who you spoke to."
          confirmLabel="Approve"
          onConfirm={approve}
          onCancel={() => setApproving(null)}
        />
      )}

      {declining && (
        <ReasonPrompt
          title={`Decline live API access for ${name(declining)}`}
          description="The reason is for the audit log. The message below, if any, is shown to the shop in the app. They can ask again."
          confirmLabel="Decline"
          danger
          onConfirm={decline}
          onCancel={() => {
            setDeclining(null);
            setNote("");
          }}
        >
          <label className="stack">
            <span className="muted">Message to the shop (optional)</span>
            <input
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For example: call us on the support line so we can set this up with your developer"
            />
          </label>
        </ReasonPrompt>
      )}
    </div>
  );
}

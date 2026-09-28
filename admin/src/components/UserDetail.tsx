import { useCallback, useEffect, useState } from "react";
import { api, type UserDetail as Detail } from "../api";
import { ReasonPrompt } from "./ReasonPrompt";
import { ApiKeysPanel } from "./ApiKeysPanel";

type PendingAction = "freeze" | "unfreeze" | "clearLockouts" | "revokeDevices";

const ACTION_COPY: Record<
  PendingAction,
  { title: string; description: string; confirm: string; danger?: boolean }
> = {
  freeze: {
    title: "Freeze this account",
    description:
      "The customer keeps access to their history but cannot send, pay, cash out or receive an agent top-up. Reversible.",
    confirm: "Freeze account",
    danger: true,
  },
  unfreeze: {
    title: "Reactivate this account",
    description: "Money movement is restored immediately.",
    confirm: "Reactivate",
  },
  clearLockouts: {
    title: "Clear lockouts",
    description:
      "Resets failed PIN and agent-code counters so the customer can try again straight away.",
    confirm: "Clear lockouts",
  },
  revokeDevices: {
    title: "Revoke trusted devices",
    description:
      "Signs the customer out of every device that can log in with a PIN. They will need to verify by SMS again.",
    confirm: "Revoke devices",
    danger: true,
  },
};

function money(cents?: number, currency = "USD") {
  if (cents === undefined || cents === null) return "—";
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function when(ts?: { _seconds?: number; seconds?: number }) {
  const secs = ts?._seconds ?? ts?.seconds;
  if (!secs) return "—";
  return new Date(secs * 1000).toLocaleString();
}

export function UserDetail({ userId }: { userId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getUser(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load user");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (reason: string) => {
    if (!action) return;
    if (action === "freeze") await api.setAccountStatus(userId, "frozen", reason);
    if (action === "unfreeze") await api.setAccountStatus(userId, "active", reason);
    if (action === "clearLockouts") await api.clearLockouts(userId, reason);
    if (action === "revokeDevices") await api.revokeDevices(userId, reason);
    setNotice(`${ACTION_COPY[action].title} — done.`);
    setAction(null);
    await load();
  };

  if (loading) return <div className="panel empty">Loading…</div>;
  if (error) return <div className="panel banner error">{error}</div>;
  if (!detail) return null;

  const profile = detail.profile as Record<string, string | undefined>;
  const frozen = detail.accountStatus === "frozen";
  const closed = detail.accountStatus === "closed";

  return (
    <div>
      {notice && <div className="banner ok">{notice}</div>}

      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>{profile.fullName || "(no name)"}</h2>
          <span className={`badge ${detail.accountStatus}`}>{detail.accountStatus}</span>
          <div className="spacer" />
          <button className="ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        <h3>Profile</h3>
        <dl className="kv">
          <dt>Phone</dt>
          <dd>{profile.phoneNumber || "—"}</dd>
          <dt>Account type</dt>
          <dd>{profile.accountType || "customer"}</dd>
          <dt>KYC</dt>
          <dd>{profile.kycStatus || "—"}</dd>
          <dt>Role request</dt>
          <dd>
            {profile.roleRequestStatus
              ? `${profile.roleRequestStatus}${
                  profile.roleRequestedRole ? ` (${profile.roleRequestedRole})` : ""
                }`
              : "—"}
          </dd>
          <dt>PIN set</dt>
          <dd>{detail.hasPin ? "yes" : "no"}</dd>
          <dt>Trusted devices</dt>
          <dd>{detail.trustedDeviceCount}</dd>
          <dt>uid</dt>
          <dd>{detail.userId}</dd>
          {frozen && (
            <>
              <dt>Frozen reason</dt>
              <dd>{profile.frozenReason || "—"}</dd>
            </>
          )}
        </dl>

        <h3>Wallet</h3>
        <dl className="kv">
          <dt>Balance</dt>
          <dd>{money(detail.wallet?.balance, detail.wallet?.currency)}</dd>
          <dt>Ledger freeze flag</dt>
          <dd>
            {detail.wallet?.frozen ? "frozen" : "not frozen"}
            {detail.wallet && detail.wallet.frozen !== frozen && (
              <span className="badge closed" style={{ marginLeft: 8 }}>
                mismatch
              </span>
            )}
          </dd>
        </dl>

        <h3>Support actions</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {frozen ? (
            <button className="primary" onClick={() => setAction("unfreeze")}>
              Reactivate
            </button>
          ) : (
            <button className="danger" onClick={() => setAction("freeze")} disabled={closed}>
              Freeze
            </button>
          )}
          <button onClick={() => setAction("clearLockouts")}>Clear lockouts</button>
          <button
            onClick={() => setAction("revokeDevices")}
            disabled={detail.trustedDeviceCount === 0}
          >
            Revoke devices ({detail.trustedDeviceCount})
          </button>
        </div>
        {closed && (
          <p className="muted" style={{ fontSize: 12 }}>
            This account is closed; freeze and reactivate do not apply.
          </p>
        )}
      </div>

      {(profile.accountType === "merchant" || profile.accountType === "agent_merchant") && (
        <ApiKeysPanel merchantId={detail.userId} disabled={detail.accountStatus !== "active"} />
      )}

      <div className="panel">
        <h2>Recent transactions</h2>
        {detail.transactions.length === 0 ? (
          <div className="empty">No transactions.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Description</th>
                <th>Status</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="muted">{when(tx.createdAt)}</td>
                  <td>{tx.type || "—"}</td>
                  <td>{tx.description || "—"}</td>
                  <td>{tx.status || "—"}</td>
                  <td className="num">{money(tx.amount, tx.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {action && (
        <ReasonPrompt
          title={ACTION_COPY[action].title}
          description={ACTION_COPY[action].description}
          confirmLabel={ACTION_COPY[action].confirm}
          danger={ACTION_COPY[action].danger}
          onConfirm={run}
          onCancel={() => setAction(null)}
        />
      )}
    </div>
  );
}

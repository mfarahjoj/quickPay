import { useCallback, useEffect, useState } from "react";
import { api, type UserDetail as Detail } from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { Avatar, EmptyState, Loading } from "./ui";

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

/** "USD 1284.50" → small currency, large figure. Anything else renders as-is. */
function Figure({ text }: { text: string }) {
  const m = /^([A-Z]{3}) (.+)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <span className="stat-cur">{m[1]}</span>
      {m[2]}
    </>
  );
}

/** Pill colour for a transaction status. Anything unrecognised stays neutral. */
function statusTone(status?: string) {
  switch (status) {
    case "completed":
    case "success":
      return "ok";
    case "pending":
      return "warn";
    case "failed":
    case "rejected":
      return "bad";
    default:
      return "";
  }
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

  if (loading)
    return (
      <div className="panel">
        <Loading />
      </div>
    );
  if (error) return <div className="banner error">{error}</div>;
  if (!detail) return null;

  const profile = detail.profile as Record<string, string | undefined>;
  const frozen = detail.accountStatus === "frozen";
  const closed = detail.accountStatus === "closed";

  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}

      <div className="panel">
        <div className="person-head">
          <Avatar name={profile.fullName} size={56} />
          <div className="person-text">
            <div className="row">
              <h2>{profile.fullName || "(no name)"}</h2>
              <span className={`badge ${detail.accountStatus}`}>{detail.accountStatus}</span>
            </div>
            <div className="sub">
              {profile.phoneNumber || "(no phone)"} · {profile.accountType || "customer"}
            </div>
          </div>
          <div className="spacer" />
          <button className="ghost" onClick={() => void load()}>
            <Icon name="refresh" size={16} />
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
          <dd className="mono">{detail.userId}</dd>
          {frozen && (
            <>
              <dt>Frozen reason</dt>
              <dd>{profile.frozenReason || "—"}</dd>
            </>
          )}
        </dl>

        <h3>Wallet</h3>
        <div className="stat">
          <span className="stat-label">Balance</span>
          <span className="stat-value">
            <Figure text={money(detail.wallet?.balance, detail.wallet?.currency)} />
          </span>
        </div>
        <dl className="kv">
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
        <div className="row wrap" style={{ marginTop: 10 }}>
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
          <p className="hint" style={{ marginTop: 12 }}>
            This account is closed; freeze and reactivate do not apply.
          </p>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Recent transactions</h2>
        </div>
        {detail.transactions.length === 0 ? (
          <EmptyState title="No transactions" />
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
                </tr>
              </thead>
              <tbody>
                {detail.transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="muted nowrap">{when(tx.createdAt)}</td>
                    <td className="nowrap">{tx.type || "—"}</td>
                    <td className="wide">{tx.description || "—"}</td>
                    <td>
                      {tx.status ? (
                        <span className={`badge ${statusTone(tx.status)}`}>{tx.status}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">{money(tx.amount, tx.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

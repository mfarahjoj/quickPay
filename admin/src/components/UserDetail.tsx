import { useCallback, useEffect, useState } from "react";
import { api, type AgentPosition, type UserDetail as Detail, formatFloat } from "../api";
import { AccountWork } from "./AccountWork";
import { FloatRequestModal } from "./FloatRequestModal";
import { TopupForm } from "./TopupDesk";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { Avatar, EmptyState, Loading } from "./ui";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { AdjustModal } from "./AdjustModal";

type PendingAction = "freeze" | "unfreeze" | "clearLockouts" | "allowPinReset" | "revokeDevices";

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
      "Resets failed PIN and agent-code counters so the customer can try again straight away. This also opens a PIN that locked after too many wrong tries, so only do it once you've confirmed who you're talking to, in person or against their ID.",
    confirm: "Clear lockouts",
  },
  allowPinReset: {
    title: "Open a PIN reset",
    description:
      "For a customer who forgot their PIN and is with you in person. You never see or set the PIN: for the next 30 minutes they can tap \"Forgot PIN?\" in the app, confirm the SMS code and choose a new one, without the usual trusted-phone or ID question. Sending money is still paused for 24 hours afterwards, their other phones are signed out, and they are notified.",
    confirm: "Open PIN reset",
    danger: true,
  },
  revokeDevices: {
    title: "Revoke trusted devices",
    description:
      "Signs the customer out of every device that can log in with a PIN. They will need to verify by SMS again.",
    confirm: "Revoke devices",
    danger: true,
  },
};

/** "$12.50" or "30,000 SLSH": shillings are whole, never cents. */
function money(amount?: number, currency = "USD") {
  if (amount === undefined || amount === null) return "—";
  return formatFloat(amount, currency === "SLS" || currency === "SLSH" ? "SLS" : "USD");
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

const AGENT_TYPES = ["topup_agent", "agent_merchant"];

/**
 * One account, start to finish: who they are, what is waiting on Zapp for
 * them on any desk (decided here), their money and the actions on it, and
 * their history. `canRunFloat` (ops, super) covers money: top-ups, float,
 * payouts, disputes and balance corrections; `canReview` (compliance, super)
 * covers ID checks and role applications.
 */
export function UserDetail({
  userId,
  adminUid,
  canRunFloat = false,
  canReview = false,
}: {
  userId: string;
  adminUid: string;
  canRunFloat?: boolean;
  canReview?: boolean;
}) {
  const canAdjust = canRunFloat;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  // Opening a PIN reset needs an in-person ID check, confirmed per use.
  const [idChecked, setIdChecked] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);
  const [agent, setAgent] = useState<AgentPosition | null>(null);
  const [floatOpen, setFloatOpen] = useState(false);
  // Remounts the open-items panel after an action elsewhere on the page.
  const [workKey, setWorkKey] = useState(0);

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

  const accountType = String((detail?.profile as Record<string, unknown> | undefined)?.accountType ?? "");
  const isAgent = AGENT_TYPES.includes(accountType);

  const loadAgent = useCallback(async () => {
    if (!isAgent || !canRunFloat) return setAgent(null);
    try {
      const all = await api.listAgentFloat();
      setAgent(all.find((a) => a.agentId === userId) ?? null);
    } catch {
      setAgent(null);
    }
  }, [isAgent, canRunFloat, userId]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent]);

  const changed = async (message: string) => {
    setNotice(message);
    await Promise.all([load(), loadAgent()]);
  };

  const run = async (reason: string) => {
    if (!action) return;
    if (action === "freeze") await api.setAccountStatus(userId, "frozen", reason);
    if (action === "unfreeze") await api.setAccountStatus(userId, "active", reason);
    if (action === "clearLockouts") await api.clearLockouts(userId, reason);
    if (action === "allowPinReset") {
      const { expiresAt } = await api.allowPinReset(userId, reason);
      setNotice(
        `PIN reset opened until ${new Date(expiresAt).toLocaleTimeString()}. Ask the customer to tap "Forgot PIN?" in the app now.`
      );
      setAction(null);
      await load();
      return;
    }
    if (action === "revokeDevices") await api.revokeDevices(userId, reason);
    setNotice(`${ACTION_COPY[action].title} — done.`);
    setAction(null);
    await load();
    setWorkKey((k) => k + 1);
  };

  // Only the first load blanks the page; a refresh after an action keeps
  // open panels (and their messages) on screen.
  if (loading && !detail)
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
          <dd>
            {detail.hasPin ? "yes" : "no"}
            {detail.pinHardLocked
              ? " · locked after too many wrong PINs"
              : detail.pinFailedAttempts
                ? ` · ${detail.pinFailedAttempts} wrong in a row`
                : ""}
            {detail.pinResetGrantUntil &&
              ` · staff reset open until ${new Date(detail.pinResetGrantUntil).toLocaleTimeString()}`}
          </dd>
          <dt>Device check</dt>
          <dd>{deviceRiskText(profile.deviceRisk)}</dd>
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

        <h3>Money</h3>
        <div className="row wrap" style={{ gap: 12, marginTop: 10 }}>
          <div className="stat" style={{ flex: 1, minWidth: 150 }}>
            <span className="stat-label">Dollar wallet</span>
            <span className="stat-value">
              <Figure text={money(detail.wallet?.balance, detail.wallet?.currency)} />
            </span>
          </div>
          <div className="stat" style={{ flex: 1, minWidth: 150 }}>
            <span className="stat-label">Shilling wallet</span>
            <span className="stat-value">
              <Figure text={money(detail.wallet?.sls?.balance ?? 0, "SLS")} />
            </span>
          </div>
          {agent && (
            <>
              <div className="stat" style={{ flex: 1, minWidth: 150 }}>
                <span className="stat-label">Agent float</span>
                <span className="stat-value">
                  <Figure text={money(agent.balanceCents, "USD")} />
                </span>
              </div>
              {agent.slsBalance !== undefined && (
                <div className="stat" style={{ flex: 1, minWidth: 150 }}>
                  <span className="stat-label">Shilling float</span>
                  <span className="stat-value">
                    <Figure text={money(agent.slsBalance, "SLS")} />
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        {canRunFloat && (
          <div className="row wrap" style={{ marginTop: 12 }}>
            <button
              className={toppingUp ? "ghost" : "primary"}
              onClick={() => setToppingUp((v) => !v)}
              disabled={!detail.wallet}
            >
              <Icon name="banknote" size={16} />
              {toppingUp ? "Close top-up" : "Top up wallet"}
            </button>
            {agent && (
              <button onClick={() => setFloatOpen(true)} disabled={detail.accountStatus !== "active"}>
                Issue / withdraw float
              </button>
            )}
            {canAdjust && (
              <button onClick={() => setAdjusting(true)} disabled={!detail.wallet}>
                Adjust balance
              </button>
            )}
          </div>
        )}
        {toppingUp && (
          <div className="work-expand">
            <TopupForm
              userId={detail.userId}
              embedded
              onPosted={async () => {
                await load();
              }}
            />
          </div>
        )}
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
            onClick={() => {
              setIdChecked(false);
              setAction("allowPinReset");
            }}
            disabled={!detail.hasPin || closed}
          >
            Open PIN reset
          </button>
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

      <AccountWork
        key={workKey}
        userId={detail.userId}
        name={profile.fullName || "this account"}
        adminUid={adminUid}
        canReview={canReview}
        canRunFloat={canRunFloat}
        onChanged={changed}
      />

      {(profile.accountType === "merchant" || profile.accountType === "agent_merchant") && (
        <ApiKeysPanel merchantId={detail.userId} disabled={detail.accountStatus !== "active"} />
      )}

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
                  <th>Receipt</th>
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
                    <td className="mono nowrap">{tx.receiptNumber || "—"}</td>
                    <td className="wide">
                      {tx.description || "—"}
                      {tx.reference ? <span className="muted"> · {tx.reference}</span> : null}
                    </td>
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

      {floatOpen && agent && (
        <FloatRequestModal
          agent={agent}
          onCancel={() => setFloatOpen(false)}
          onDone={async (message) => {
            setFloatOpen(false);
            setWorkKey((k) => k + 1);
            await changed(message);
          }}
        />
      )}

      {adjusting && (
        <AdjustModal
          userId={detail.userId}
          name={profile.fullName || "this customer"}
          onCancel={() => setAdjusting(false)}
          onDone={async (message) => {
            setAdjusting(false);
            await changed(message);
          }}
        />
      )}

      {action && (
        <ReasonPrompt
          title={ACTION_COPY[action].title}
          description={ACTION_COPY[action].description}
          confirmLabel={ACTION_COPY[action].confirm}
          danger={ACTION_COPY[action].danger}
          confirmDisabled={action === "allowPinReset" && !idChecked}
          onConfirm={run}
          onCancel={() => setAction(null)}
        >
          {action === "allowPinReset" && (
            <label className="row" style={{ gap: 8, margin: "12px 0" }}>
              <input
                type="checkbox"
                checked={idChecked}
                onChange={(e) => setIdChecked(e.target.checked)}
              />
              <span>
                I checked their ID in person, and the name and photo match{" "}
                <strong>{profile.fullName || "this account"}</strong>.
              </span>
            </label>
          )}
        </ReasonPrompt>
      )}
    </div>
  );
}

/** The app's latest root/jailbreak report (review E14): a signal, not a block. */
function deviceRiskText(risk: unknown): string {
  const r = risk as { flagged?: boolean; rooted?: boolean; hooked?: boolean; platform?: string } | undefined;
  if (!r) return "—";
  if (!r.flagged) return `clean (${r.platform ?? "?"})`;
  const what = [r.rooted && "rooted / jailbroken", r.hooked && "hooking tools"].filter(Boolean).join(", ");
  return `⚠ ${what} (${r.platform ?? "?"})`;
}

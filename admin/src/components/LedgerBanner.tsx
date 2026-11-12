import { useEffect, useState } from "react";
import { api, type LedgerHealth } from "../api";

function when(ts?: { _seconds?: number; seconds?: number }) {
  const secs = ts?._seconds ?? ts?.seconds;
  if (!secs) return "unknown";
  return new Date(secs * 1000).toLocaleString();
}

/**
 * What the scheduled invariant job last found, plus one thing checked live.
 *
 * Per-account drift cannot be computed on demand (it needs a full journal
 * replay), so that half reports the last scheduled run. The spend-index probe
 * is cheap, so it runs on every call — and it outranks drift in the banner,
 * because drift is money already misrecorded whereas an unservable spend
 * query means nobody can pay, cash out or send anything at all right now.
 */
export function LedgerBanner({ onOpen }: { onOpen?: () => void } = {}) {
  const [health, setHealth] = useState<LedgerHealth | null>(null);

  // Problems link straight to the ledger desk, for admins who can open it.
  const investigate = onOpen ? (
    <>
      {" "}
      <button className="link-btn" onClick={onOpen}>
        Investigate
      </button>
    </>
  ) : null;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .ledgerHealth()
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return <div className="banner warn">Could not read ledger health.</div>;
  }
  if (!health) return null;

  if (health.neverRun) {
    return (
      <div className="banner warn">
        The ledger invariant check has never run. Nothing is verifying that
        balances match the journal.
        {investigate}
      </div>
    );
  }

  // Outage first: a customer hitting this sees every pay option fail.
  if (health.spendIndex && !health.spendIndex.ok) {
    return (
      <div className="banner error">
        <strong>Payments are down.</strong> The spend-limit query cannot be
        served, so cash-out, QR payment, send money, remittance and payroll are
        all failing. Check the <code>transactions</code> composite index on
        fromUserId / type / createdAt / amount.
        {health.spendIndex.error ? ` — ${health.spendIndex.error}` : null}
        {investigate}
      </div>
    );
  }

  const drifted = health.openAlertCount > 0 || health.lastRun?.ok === false;

  return (
    <div className={`banner ${drifted ? "error" : "ok"}`}>
      {drifted ? (
        <>
          <strong>Ledger drift detected.</strong> {health.lastRun?.driftCount ?? 0}{" "}
          mismatch(es) as of {when(health.lastRun?.ranAt)}. {health.openAlertCount}{" "}
          unacknowledged alert(s).
          {investigate}
        </>
      ) : (
        <>
          Ledger verified: {health.lastRun?.entryCount ?? 0} entries, zero drift, checked{" "}
          {when(health.lastRun?.ranAt)}.
        </>
      )}
    </div>
  );
}

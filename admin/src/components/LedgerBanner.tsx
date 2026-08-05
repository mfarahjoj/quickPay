import { useEffect, useState } from "react";
import { api, type LedgerHealth } from "../api";

function when(ts?: { _seconds?: number; seconds?: number }) {
  const secs = ts?._seconds ?? ts?.seconds;
  if (!secs) return "unknown";
  return new Date(secs * 1000).toLocaleString();
}

/**
 * What the scheduled invariant job last found.
 *
 * Per-account drift cannot be computed on demand (it needs a full journal
 * replay), so this reports the last scheduled run rather than checking now.
 */
export function LedgerBanner() {
  const [health, setHealth] = useState<LedgerHealth | null>(null);
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

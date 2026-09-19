import { useCallback, useEffect, useState } from "react";
import { api, type PayoutRow } from "../api";
import { ReasonPrompt } from "./ReasonPrompt";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function when(ts?: { _seconds?: number; seconds?: number }) {
  const secs = ts?._seconds ?? ts?.seconds;
  if (!secs) return "—";
  return new Date(secs * 1000).toLocaleString();
}

function waitingFor(ts?: { _seconds?: number; seconds?: number }) {
  const secs = ts?._seconds ?? ts?.seconds;
  if (!secs) return null;
  const hours = Math.floor((Date.now() - secs * 1000) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Merchant payouts.
 *
 * The money has already left the merchant's balance and is sitting in
 * settlement hold; what this screen does is record that the transfer went out.
 * So the order is: send the money on the rail first, then come here and enter
 * the reference. Marking it paid beforehand would put the books ahead of
 * reality, which is the drift nobody would notice until reconciliation.
 */
export function PayoutDesk() {
  const [view, setView] = useState<PayoutRow["status"]>("requested");
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settling, setSettling] = useState<PayoutRow | null>(null);
  const [reference, setReference] = useState("");
  const [rejecting, setRejecting] = useState<PayoutRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listPayouts(view));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payouts");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  const settle = async (reason: string) => {
    if (!settling) return;
    await api.settlePayout(settling.id, reference.trim(), reason);
    setNotice(
      `Recorded ${money(settling.amountCents)} to ${
        settling.businessName || settling.merchantName || settling.merchantId
      } as sent.`
    );
    setSettling(null);
    setReference("");
    await load();
  };

  const reject = async (reason: string) => {
    if (!rejecting) return;
    await api.rejectPayout(rejecting.id, reason);
    setNotice("Returned to the merchant's balance.");
    setRejecting(null);
    await load();
  };

  return (
    <div>
      {notice && <div className="banner ok">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Merchant payouts</h2>
          <div className="spacer" />
          {(["requested", "paid", "rejected"] as const).map((s) => (
            <button
              key={s}
              className={view === s ? "" : "ghost"}
              onClick={() => setView(s)}
            >
              {s === "requested" ? "To send" : s === "paid" ? "Sent" : "Declined"}
            </button>
          ))}
          <button className="ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">
            {view === "requested"
              ? "Nothing waiting. Merchants' takings are all settled."
              : "Nothing here yet."}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Send to</th>
                <th>Requested</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.businessName || row.merchantName || row.merchantId}
                    {row.requiresSeniorApproval && view === "requested" && (
                      <div className="muted">needs a senior admin</div>
                    )}
                  </td>
                  <td>{money(row.amountCents)}</td>
                  <td>
                    {row.route} · {row.destinationName}
                    <div className="muted">{row.destinationRef}</div>
                  </td>
                  <td>
                    {when(row.createdAt)}
                    {view === "requested" && waitingFor(row.createdAt) && (
                      <div className="muted">waiting {waitingFor(row.createdAt)}</div>
                    )}
                  </td>
                  <td>
                    {view === "requested" ? (
                      <div className="row">
                        <button
                          onClick={() => {
                            setReference("");
                            setSettling(row);
                          }}
                        >
                          Mark sent
                        </button>
                        <button className="ghost" onClick={() => setRejecting(row)}>
                          Decline
                        </button>
                      </div>
                    ) : row.externalReference ? (
                      <span className="muted">{row.externalReference}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {settling && (
        <ReasonPrompt
          title={`Mark ${money(settling.amountCents)} as sent`}
          description={`Send the money first, on ${settling.route}, to ${settling.destinationName} (${settling.destinationRef}). Then enter the transfer reference — without it this payout cannot be matched to a statement later.`}
          confirmLabel="Record as sent"
          confirmDisabled={reference.trim().length < 3}
          onConfirm={settle}
          onCancel={() => {
            setSettling(null);
            setReference("");
          }}
        >
          <label className="stack">
            <span className="muted">Transfer reference</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Bank reference, Zaad transaction id or receipt number"
            />
          </label>
        </ReasonPrompt>
      )}

      {rejecting && (
        <ReasonPrompt
          title={`Decline ${money(rejecting.amountCents)}`}
          description="The money goes straight back to the merchant's balance, and they are told why — so write the reason for them, not for us."
          confirmLabel="Decline and return"
          danger
          onConfirm={reject}
          onCancel={() => setRejecting(null)}
        />
      )}
    </div>
  );
}

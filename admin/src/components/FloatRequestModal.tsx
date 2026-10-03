import { useId, useState } from "react";
import { api, type AgentPosition, type FloatDirection, type FloatRoute } from "../api";
import { Spinner } from "./ui";

interface Props {
  agent: AgentPosition;
  onDone: (message: string) => void;
  onCancel: () => void;
}

const ROUTES: { id: FloatRoute; label: string; needsReference: boolean }[] = [
  { id: "cash", label: "Cash at the office", needsReference: false },
  { id: "zaad", label: "Zaad transfer", needsReference: true },
  { id: "edahab", label: "eDahab transfer", needsReference: true },
  { id: "bank", label: "Bank deposit", needsReference: true },
];

const MIN_REASON = 8;

export function FloatRequestModal({ agent, onDone, onCancel }: Props) {
  const [direction, setDirection] = useState<FloatDirection>("issue");
  const [amount, setAmount] = useState("");
  const [route, setRoute] = useState<FloatRoute>("cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  const routeMeta = ROUTES.find((r) => r.id === route)!;

  // Parse dollars to integer cents at the edge — the API is cents-only.
  const dollars = Number(amount);
  const amountCents =
    Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;

  const withdrawingTooMuch =
    direction === "withdraw" && amountCents > agent.balanceCents;

  const valid =
    amountCents > 0 &&
    reason.trim().length >= MIN_REASON &&
    (!routeMeta.needsReference || reference.trim().length >= 3) &&
    !withdrawingTooMuch;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestFloat({
        agentId: agent.agentId,
        direction,
        amountCents,
        route,
        ...(reference.trim() ? { externalReference: reference.trim() } : {}),
        reason: reason.trim(),
      });
      onDone(
        res.requiresSecondApprover
          ? "Requested — a second admin must approve this amount."
          : "Requested — approve it from the queue below."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal">
        <h2 id={titleId}>Float for {agent.fullName || agent.agentId}</h2>
        <p>
          Currently holding ${(agent.balanceCents / 100).toFixed(2)}. Requesting does
          not move money — an approval posts it.
        </p>

        {error && <div className="banner error">{error}</div>}

        <div className="stack">
          <label className="stack">
            <span className="muted">Direction</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as FloatDirection)}
            >
              <option value="issue">Issue — agent buys float</option>
              <option value="withdraw">Withdraw — agent returns float for cash</option>
            </select>
          </label>

          <label className="stack">
            <span className="muted">Amount (USD)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500.00"
              autoFocus
            />
          </label>
          {withdrawingTooMuch && (
            <div className="hint" style={{ color: "var(--danger)" }}>
              More than the agent holds (${(agent.balanceCents / 100).toFixed(2)}).
            </div>
          )}

          <label className="stack">
            <span className="muted">
              {direction === "issue" ? "How did they pay?" : "How are they being paid?"}
            </span>
            <select
              value={route}
              onChange={(e) => setRoute(e.target.value as FloatRoute)}
            >
              {ROUTES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <div className="hint">
            This decides which asset account the value is booked against, so the
            books can be reconciled against the real statement.
          </div>

          {routeMeta.needsReference && (
            <label className="stack">
              <span className="muted">External reference</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Zaad transaction id / deposit slip no."
              />
            </label>
          )}

          <label className="stack">
            <span className="muted">Reason (recorded in the audit log)</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Agent paid cash at the Hargeisa office"
            />
          </label>
        </div>

        <div className="actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={submit} disabled={!valid || busy}>
            {busy ? (
              <>
                <Spinner />
                Submitting…
              </>
            ) : (
              "Submit request"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

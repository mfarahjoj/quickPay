import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  /** Extra fields an action needs alongside its reason, e.g. a bank reference. */
  children?: ReactNode;
  /** Set when those extra fields are not filled in yet. */
  confirmDisabled?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}

const MIN_REASON = 8;

/**
 * Every state-changing admin action goes through here.
 *
 * The backend requires a reason of at least 8 characters; asking for it in the
 * UI keeps the audit log meaningful instead of full of rejected calls.
 */
export function ReasonPrompt({
  title,
  description,
  confirmLabel,
  danger,
  children,
  confirmDisabled,
  onConfirm,
  onCancel,
}: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = reason.trim().length < MIN_REASON;

  const submit = async () => {
    if (tooShort || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{title}</h2>
        <p>{description}</p>

        {error && <div className="banner error">{error}</div>}

        {children}

        <label className="stack">
          <span className="muted">Reason (recorded in the audit log)</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you doing this?"
            autoFocus
          />
        </label>
        {tooShort && reason.length > 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            At least {MIN_REASON} characters.
          </div>
        )}

        <div className="actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={danger ? "danger" : "primary"}
            onClick={submit}
            disabled={tooShort || busy || confirmDisabled}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

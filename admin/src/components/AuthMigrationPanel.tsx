import { useState } from "react";
import { api, type AuthMigrationResult } from "../api";
import { ReasonPrompt } from "./ReasonPrompt";

/**
 * One-off: move every account's PIN hash and lockout state off the profile
 * the phone reads (ONBOARDING_SECURITY_REVIEW.md, A1). Accounts also move on
 * their own the next time their PIN is used; this does the rest at once.
 * Preview first, then a super admin applies it. A rerun finds nothing.
 */
export function AuthMigrationPanel({ isSuper }: { isSuper: boolean }) {
  const [result, setResult] = useState<AuthMigrationResult | null>(null);
  const [prompt, setPrompt] = useState<"preview" | "apply" | null>(null);

  const run = async (reason: string) => {
    const res = await api.migrateAuthSecrets(prompt === "apply", reason);
    setResult(res);
    setPrompt(null);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Move PIN secrets server-side</h2>
      </div>
      <p className="hint">
        One-off, after this release is deployed. Moves each account's PIN hash, lockout counters and reset history to a
        record no phone can read.
      </p>
      {result && (
        <div className={`banner ${result.applied ? "ok" : ""}`}>
          {result.applied
            ? `Moved ${result.moved} of ${result.scanned} accounts.`
            : `${result.toMove} of ${result.scanned} accounts still to move (${result.withPin} with a PIN).`}
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => setPrompt("preview")}>{result ? "Preview again" : "Preview"}</button>
        {isSuper && result && !result.applied && result.toMove > 0 && (
          <button className="primary" onClick={() => setPrompt("apply")}>
            Move {result.toMove} account{result.toMove === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {!isSuper && result && <p className="hint">A super admin applies it.</p>}
      {prompt && (
        <ReasonPrompt
          title={prompt === "apply" ? "Move PIN secrets" : "Preview the move"}
          description={
            prompt === "apply"
              ? "Copies each account's PIN secrets to the server-only record and removes them from the profile. PINs keep working."
              : "Nothing changes. Counts the accounts still to move."
          }
          confirmLabel={prompt === "apply" ? "Move" : "Preview"}
          onConfirm={run}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}

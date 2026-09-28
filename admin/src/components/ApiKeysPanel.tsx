import { useCallback, useEffect, useState } from "react";
import { api, type ApiKeyRow } from "../api";
import { ReasonPrompt } from "./ReasonPrompt";

/**
 * Merchant API keys (docs/MERCHANT_API.md). A key lets the merchant's own
 * server raise charges and refund them, so issuing one is an audited ops
 * action like any other. The full key is shown once, right after issuing;
 * only its hash is stored, so a lost key is revoked and replaced.
 */
export function ApiKeysPanel({ merchantId, disabled }: { merchantId: string; disabled: boolean }) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [label, setLabel] = useState("");
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const [fresh, setFresh] = useState<{ label: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setKeys(await api.listApiKeys(merchantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load API keys");
    }
  }, [merchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = async (reason: string) => {
    const created = await api.issueApiKey(merchantId, label.trim(), reason);
    setFresh({ label: created.label, apiKey: created.apiKey });
    setCopied(false);
    setIssuing(false);
    setLabel("");
    await load();
  };

  const revoke = async (reason: string) => {
    if (!revoking) return;
    await api.revokeApiKey(revoking.keyId, reason);
    setRevoking(null);
    await load();
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const active = keys?.filter((k) => !k.revoked) ?? [];

  return (
    <div className="panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>API keys</h2>
        <div className="spacer" />
        <button className="primary" onClick={() => setIssuing(true)} disabled={disabled || active.length >= 5}>
          Issue key
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        For merchants taking Zapp Pay on their website or till. Customers still approve every
        payment in the app with their PIN.
      </p>

      {error && <div className="banner error">{error}</div>}

      {fresh && (
        <div className="banner ok">
          <div>
            <strong>{fresh.label}</strong> — copy this key now and send it to the merchant over a
            private channel. It will not be shown again.
          </div>
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <code style={{ wordBreak: "break-all", flex: 1 }}>{fresh.apiKey}</code>
            <button onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
            <button className="ghost" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {keys === null && !error ? (
        <div className="empty">Loading…</div>
      ) : keys && keys.length === 0 ? (
        <div className="empty">No keys issued.</div>
      ) : (
        keys && (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.keyId}>
                  <td>{k.label}</td>
                  <td>
                    <code>{k.hint}</code>
                  </td>
                  <td className="muted">{new Date(k.createdAt).toLocaleString()}</td>
                  <td className="muted">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                  <td>
                    <span className={`badge ${k.revoked ? "closed" : "active"}`}>
                      {k.revoked ? "revoked" : "active"}
                    </span>
                  </td>
                  <td className="num">
                    {!k.revoked && (
                      <button className="danger" onClick={() => setRevoking(k)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {issuing && (
        <ReasonPrompt
          title="Issue an API key"
          description="The merchant's server will be able to create charges and refund payments it took. Name the key after where it will be used."
          confirmLabel="Issue key"
          confirmDisabled={label.trim().length === 0}
          onConfirm={issue}
          onCancel={() => {
            setIssuing(false);
            setLabel("");
          }}
        >
          <label className="stack">
            <span className="muted">Label</span>
            <input
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Website, Till 2"
            />
          </label>
        </ReasonPrompt>
      )}

      {revoking && (
        <ReasonPrompt
          title={`Revoke “${revoking.label}”`}
          description="Requests with this key stop working immediately. Charges it already created are unaffected."
          confirmLabel="Revoke key"
          danger
          onConfirm={revoke}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  );
}

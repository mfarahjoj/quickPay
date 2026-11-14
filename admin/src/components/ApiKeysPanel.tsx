import { useCallback, useEffect, useState } from "react";
import { api, type ApiKeyRow, type ApiPartnerRow } from "../api";
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
  const [testMode, setTestMode] = useState(false);
  const [transfers, setTransfers] = useState(false);
  const [partner, setPartner] = useState<ApiPartnerRow | null>(null);
  const [editingPartner, setEditingPartner] = useState<ApiPartnerRow | null>(null);
  // The test numbers as typed; split when saved, so a new line can be typed.
  const [testNumbersText, setTestNumbersText] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [k, p] = await Promise.all([api.listApiKeys(merchantId), api.getApiPartner(merchantId)]);
      setKeys(k);
      setPartner(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load API keys");
    }
  }, [merchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = async (reason: string) => {
    const created = await api.issueApiKey(merchantId, label.trim(), reason, {
      mode: testMode ? "test" : "live",
      transfers,
    });
    setFresh({ label: created.label, apiKey: created.apiKey });
    setCopied(false);
    setIssuing(false);
    setLabel("");
    setTestMode(false);
    setTransfers(false);
    await load();
  };

  const savePartner = async (reason: string) => {
    if (!editingPartner) return;
    const { updatedAt: _updatedAt, ...settings } = editingPartner;
    const testPhoneNumbers = testNumbersText
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setPartner(await api.setApiPartner(merchantId, { ...settings, testPhoneNumbers }, reason));
    setEditingPartner(null);
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
                  <td>
                    {k.label}
                    {k.mode === "test" && <span className="badge"> test</span>}
                    {k.scopes?.includes("transfers") && <span className="badge"> transfers</span>}
                  </td>
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
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
            <span>Test key (moves no money)</span>
          </label>
          {partner?.transfersEnabled && (
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={transfers} onChange={(e) => setTransfers(e.target.checked)} />
              <span>Can make transfers (pays Zapp accounts from this merchant's wallet, no PIN)</span>
            </label>
          )}
        </ReasonPrompt>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>Partner transfers</h3>
        <div className="spacer" />
        <button
          onClick={() => {
            if (!partner) return;
            setEditingPartner({ ...partner });
            setTestNumbersText((partner.testPhoneNumbers ?? []).join("\n"));
          }}
          disabled={disabled || !partner}
        >
          Edit
        </button>
      </div>
      {partner && (
        <p className="muted" style={{ fontSize: 12 }}>
          {partner.transfersEnabled ? (
            <>
              <strong>On.</strong> Up to {usd(partner.maxTransferUsdCents)} a transfer and{" "}
              {usd(partner.dailyTransferUsdCents)} a day (shillings counted at the rate).
            </>
          ) : (
            "Off. This merchant's keys cannot pay anyone."
          )}{" "}
          Charge fee:{" "}
          {partner.chargeFeeRate === null ? "standard" : `${(partner.chargeFeeRate * 100).toFixed(2)}%`}.{" "}
          Test numbers:{" "}
          {partner.testPhoneNumbers?.length ? partner.testPhoneNumbers.join(", ") : "none (+252 numbers only)"}.
        </p>
      )}

      {editingPartner && (
        <ReasonPrompt
          title="Partner transfers"
          description="A partner's transfer keys pay any Zapp account from its wallet with no PIN (Ridy paying drivers). Super admins only."
          confirmLabel="Save"
          onConfirm={savePartner}
          onCancel={() => setEditingPartner(null)}
        >
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={editingPartner.transfersEnabled}
              onChange={(e) => setEditingPartner({ ...editingPartner, transfersEnabled: e.target.checked })}
            />
            <span>Transfers on</span>
          </label>
          <label className="stack">
            <span className="muted">Most per transfer (US$)</span>
            <input
              type="number"
              min={1}
              value={editingPartner.maxTransferUsdCents / 100}
              onChange={(e) =>
                setEditingPartner({ ...editingPartner, maxTransferUsdCents: Math.round(Number(e.target.value) * 100) })
              }
            />
          </label>
          <label className="stack">
            <span className="muted">Most per day (US$)</span>
            <input
              type="number"
              min={1}
              value={editingPartner.dailyTransferUsdCents / 100}
              onChange={(e) =>
                setEditingPartner({ ...editingPartner, dailyTransferUsdCents: Math.round(Number(e.target.value) * 100) })
              }
            />
          </label>
          <label className="stack">
            <span className="muted">Fee on this merchant's charges (%), empty for standard</span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.05}
              value={editingPartner.chargeFeeRate === null ? "" : editingPartner.chargeFeeRate * 100}
              onChange={(e) =>
                setEditingPartner({
                  ...editingPartner,
                  chargeFeeRate: e.target.value === "" ? null : Number(e.target.value) / 100,
                })
              }
            />
          </label>
          <label className="stack">
            <span className="muted">
              Test numbers outside +252 (Firebase test phone numbers), one per line. This merchant may charge,
              pay and look these up; every other number must be +252.
            </span>
            <textarea
              rows={3}
              placeholder="+447700900123"
              value={testNumbersText}
              onChange={(e) => setTestNumbersText(e.target.value)}
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

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

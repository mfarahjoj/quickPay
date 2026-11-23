import { useCallback, useEffect, useState } from "react";
import { api, type ApiAgreementRow, type ApiKeyRow, type ApiPartnerRow } from "../api";
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
  const [agreementsScope, setAgreementsScope] = useState(false);
  const [agreements, setAgreements] = useState<ApiAgreementRow[] | null>(null);
  const [revokingAgreement, setRevokingAgreement] = useState<ApiAgreementRow | null>(null);
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
      setAgreements(p.agreementsEnabled ? await api.listAgreements(merchantId) : []);
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
      agreements: agreementsScope,
    });
    setFresh({ label: created.label, apiKey: created.apiKey });
    setCopied(false);
    setIssuing(false);
    setLabel("");
    setTestMode(false);
    setTransfers(false);
    setAgreementsScope(false);
    await load();
  };

  const revokeAgreement = async (reason: string) => {
    if (!revokingAgreement) return;
    await api.revokeAgreement(revokingAgreement.id, reason);
    setRevokingAgreement(null);
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
                  <td>
                    {k.label}
                    {k.mode === "test" && <span className="badge"> test</span>}
                    {k.scopes?.includes("transfers") && <span className="badge"> transfers</span>}
                    {k.scopes?.includes("agreements") && <span className="badge"> agreements</span>}
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
          {partner?.agreementsEnabled && (
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={agreementsScope}
                onChange={(e) => setAgreementsScope(e.target.checked)}
              />
              <span>Agreements (customers approve payments in this merchant's app on their phone)</span>
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
          {partner.testPhoneNumbers?.length ? partner.testPhoneNumbers.join(", ") : "none (+252 numbers only)"}.{" "}
          Linked payments:{" "}
          {partner.agreementsEnabled ? (
            <>
              <strong>On.</strong> Up to {usd(partner.agreementMaxChargeUsdCents)} a payment and{" "}
              {usd(partner.agreementDailyUsdCents)} a day.
            </>
          ) : (
            "Off."
          )}
        </p>
      )}

      {partner?.agreementsEnabled && agreements && (
        <>
          <h3 style={{ marginTop: 16, marginBottom: 4 }}>
            Linked customers ({agreements.filter((a) => a.status === "active").length} active)
          </h3>
          {agreements.length === 0 ? (
            <div className="empty">No customer has linked yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Limits</th>
                  <th>Linked</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {agreements.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.customerPhone}
                      {!a.livemode && <span className="badge"> test</span>}
                    </td>
                    <td className="muted">{a.deviceLabel ?? "—"}</td>
                    <td className="muted">
                      {a.maxChargeUsdCents !== null && a.dailyUsdCents !== null
                        ? `${usd(a.maxChargeUsdCents)} / ${usd(a.dailyUsdCents)} a day`
                        : "—"}
                    </td>
                    <td className="muted">{a.approvedAt ? new Date(a.approvedAt).toLocaleString() : "—"}</td>
                    <td>
                      <span className={`badge ${a.status === "active" ? "active" : "closed"}`}>
                        {a.status}
                        {a.revokedBy ? ` (${a.revokedBy})` : ""}
                      </span>
                    </td>
                    <td className="num">
                      {a.status === "active" && (
                        <button className="danger" onClick={() => setRevokingAgreement(a)} disabled={disabled}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {editingPartner && (
        <ReasonPrompt
          title="Partner transfers"
          description="A partner's transfer keys pay any Zapp account from its wallet with no PIN (Ridy paying drivers). Linked payments let its customers approve payments in its app. Super admins only."
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
          <label className="row" style={{ gap: 6, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={editingPartner.agreementsEnabled}
              onChange={(e) => setEditingPartner({ ...editingPartner, agreementsEnabled: e.target.checked })}
            />
            <span>Linked payments on (customers link once in Zapp, then approve each payment in this merchant's app with Face ID or their phone passcode)</span>
          </label>
          <label className="stack">
            <span className="muted">Most per linked payment (US$). Larger ones are approved in Zapp.</span>
            <input
              type="number"
              min={1}
              value={editingPartner.agreementMaxChargeUsdCents / 100}
              onChange={(e) =>
                setEditingPartner({ ...editingPartner, agreementMaxChargeUsdCents: Math.round(Number(e.target.value) * 100) })
              }
            />
          </label>
          <label className="stack">
            <span className="muted">Most per customer per day, linked payments (US$)</span>
            <input
              type="number"
              min={1}
              value={editingPartner.agreementDailyUsdCents / 100}
              onChange={(e) =>
                setEditingPartner({ ...editingPartner, agreementDailyUsdCents: Math.round(Number(e.target.value) * 100) })
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

      {revokingAgreement && (
        <ReasonPrompt
          title={`Revoke the link for ${revokingAgreement.customerPhone}`}
          description="The merchant can no longer take payments approved in its app from this customer. Their next payment is approved in Zapp instead."
          confirmLabel="Revoke link"
          danger
          onConfirm={revokeAgreement}
          onCancel={() => setRevokingAgreement(null)}
        />
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

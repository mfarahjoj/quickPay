import { useCallback, useEffect, useState } from "react";
import { api, formatFloat, type FloatCurrency, type TopupRow, type TopupSource, type UserDetail } from "../api";
import { UserSearch } from "./UserSearch";
import { ReasonPrompt } from "./ReasonPrompt";
import { AccountLink } from "./AccountLink";
import { EmptyState, Loading } from "./ui";

const SOURCES: Array<{ id: TopupSource; label: string; refHint: string }> = [
  { id: "zaad", label: "Zaad", refHint: "Zaad transaction ID" },
  { id: "edahab", label: "eDahab", refHint: "eDahab transaction ID" },
  { id: "bank", label: "Bank transfer", refHint: "Bank reference" },
];

const sourceLabel = (s: TopupSource) => SOURCES.find((x) => x.id === s)?.label ?? s;

function when(ms: number): string {
  return new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Top up a wallet's dollars or shillings with money Zapp has received on
 * Zaad, eDahab or the bank. Each top-up comes out of that rail's float
 * account in the same currency, never converted, and is audited.
 */
export function TopupDesk() {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [recent, setRecent] = useState<TopupRow[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await api.listTopups());
      setRecentError(null);
    } catch (err) {
      setRecentError(err instanceof Error ? err.message : "Could not load top-ups");
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  return (
    <div className="stack-lg">
      <div className="split">
        <UserSearch selectedId={selectedId} onSelect={setSelectedId} />
        {selectedId ? (
          <TopupForm key={selectedId} userId={selectedId} onPosted={loadRecent} />
        ) : (
          <div className="panel">
            <EmptyState icon="search" title="No account selected">
              Find the customer, shop or agent whose wallet you're topping up.
            </EmptyState>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Recent top-ups</h2>
          <div className="spacer" />
          <button className="ghost" onClick={() => void loadRecent()}>
            Refresh
          </button>
        </div>
        {recentError ? (
          <div className="banner error">{recentError}</div>
        ) : recent === null ? (
          <Loading />
        ) : recent.length === 0 ? (
          <EmptyState icon="inbox" title="No top-ups yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th className="wide">Account</th>
                  <th>From</th>
                  <th>Reference</th>
                  <th>By</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td className="muted nowrap">{when(t.createdAtMs)}</td>
                    <td className="wide">
                      <AccountLink uid={t.uid}>{t.name || "(no name)"}</AccountLink>
                      <div className="muted mono" style={{ fontSize: 12 }}>{t.uid}</div>
                    </td>
                    <td className="nowrap">{sourceLabel(t.source)}</td>
                    <td className="mono nowrap">{t.reference}</td>
                    <td className="muted nowrap">{t.postedByEmail || t.postedBy}</td>
                    <td className="num nowrap">{formatFloat(t.amountCents, t.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** `embedded`: on an account page, which already shows the name and balances. */
export function TopupForm({
  userId,
  onPosted,
  embedded = false,
}: {
  userId: string;
  onPosted: () => Promise<void>;
  embedded?: boolean;
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [currency, setCurrency] = useState<FloatCurrency>("SLS");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<TopupSource>("zaad");
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  // One key per top-up, reused on every retry, so a lost response can't post twice.
  const [key, setKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    try {
      setDetail(await api.getUser(userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this account");
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="banner error">{error}</div>;
  if (!detail) {
    return (
      <div className="panel">
        <Loading />
      </div>
    );
  }

  const name = String(detail.profile.fullName || "(no name)");
  const phone = String(detail.profile.phoneNumber || "");
  const frozen = detail.wallet?.frozen === true || detail.accountStatus !== "active";

  // In the smallest unit: cents, or whole shillings.
  const amountCents =
    currency === "SLS" ? Math.floor(Number(amount || "0")) : Math.round(parseFloat(amount || "0") * 100);
  const refOk = reference.trim().length >= 3 && reference.trim().length <= 64;
  const valid = Number.isFinite(amountCents) && amountCents > 0 && refOk && !!detail.wallet && !frozen;
  const refHint = SOURCES.find((s) => s.id === source)!.refHint;

  const post = async (reason: string) => {
    const res = await api.topupWallet({
      uid: userId,
      amountCents,
      currency,
      source,
      reference: reference.trim(),
      reason,
      idempotencyKey: key,
    });
    setConfirming(false);
    setNotice(
      res.alreadyPosted
        ? "That top-up was already posted."
        : `Added ${formatFloat(amountCents, currency)} to ${name}'s ${currency === "SLS" ? "shilling" : "dollar"} wallet from ${sourceLabel(source)}.`
    );
    setAmount("");
    setReference("");
    setKey(crypto.randomUUID());
    await Promise.all([load(), onPosted()]);
  };

  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}

      <div className={embedded ? undefined : "panel"}>
        {!embedded && (
        <>
        <div className="panel-head">
          <h2>{name}</h2>
          {detail.accountStatus !== "active" && (
            <span className={`badge ${detail.accountStatus}`}>{detail.accountStatus}</span>
          )}
        </div>
        <p className="hint">
          {phone || "(no phone)"} · {String(detail.profile.accountType || "customer")}
        </p>

        <div className="row wrap" style={{ gap: 12, marginTop: 12 }}>
          <div className="stat" style={{ flex: 1, minWidth: 160 }}>
            <span className="stat-label">Dollar wallet</span>
            <span className="stat-value">{formatFloat(detail.wallet?.balance ?? 0, "USD")}</span>
          </div>
          <div className="stat" style={{ flex: 1, minWidth: 160 }}>
            <span className="stat-label">Shilling wallet</span>
            <span className="stat-value">{formatFloat(detail.wallet?.sls?.balance ?? 0, "SLS")}</span>
          </div>
        </div>
        </>
        )}

        {!detail.wallet ? (
          <div className="banner error" style={{ marginTop: 14 }}>This account has no wallet.</div>
        ) : frozen ? (
          <div className="banner error" style={{ marginTop: 14 }}>
            This account is {detail.accountStatus === "active" ? "frozen" : detail.accountStatus}. Reactivate it
            on its account page before topping it up.
          </div>
        ) : (
          <div className="stack" style={{ marginTop: 16, gap: 12 }}>
            <div className="segmented" role="group" aria-label="Wallet">
              <button aria-pressed={currency === "SLS"} onClick={() => { setCurrency("SLS"); setAmount(""); }}>
                Shillings
              </button>
              <button aria-pressed={currency === "USD"} onClick={() => { setCurrency("USD"); setAmount(""); }}>
                Dollars
              </button>
            </div>

            <label className="stack">
              <span className="muted">Amount ({currency === "SLS" ? "whole shillings" : "USD"})</span>
              <input
                inputMode={currency === "SLS" ? "numeric" : "decimal"}
                value={amount}
                onChange={(e) =>
                  setAmount(
                    currency === "SLS"
                      ? e.target.value.split(".")[0].replace(/[^0-9]/g, "")
                      : e.target.value.replace(/[^0-9.]/g, "")
                  )
                }
                placeholder={currency === "SLS" ? "30000" : "0.00"}
              />
              {amountCents > 0 && <span className="hint">{formatFloat(amountCents, currency)}</span>}
            </label>

            <label className="stack">
              <span className="muted">Money received on</span>
              <select value={source} onChange={(e) => setSource(e.target.value as TopupSource)}>
                {SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="stack">
              <span className="muted">{refHint}</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={refHint} maxLength={64} />
            </label>

            <div className="row">
              <button className="primary" disabled={!valid} onClick={() => setConfirming(true)}>
                Top up {amountCents > 0 ? formatFloat(amountCents, currency) : ""}
              </button>
            </div>
            <p className="hint">
              Comes out of the {sourceLabel(source)} {currency === "SLS" ? "shilling" : "dollar"} float, so only top up
              money that has really arrived. The customer gets a top-up notification. Large top-ups, counted over 24
              hours, need a senior admin.
            </p>
          </div>
        )}
      </div>

      {confirming && (
        <ReasonPrompt
          title={`Top up ${formatFloat(amountCents, currency)}`}
          description={`Adds ${formatFloat(amountCents, currency)} to ${name}'s ${
            currency === "SLS" ? "shilling" : "dollar"
          } wallet from ${sourceLabel(source)} (${reference.trim()}).`}
          confirmLabel="Top up wallet"
          onConfirm={post}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

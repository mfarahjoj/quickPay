import { useCallback, useEffect, useState } from "react";
import { api, type DisputeDetail, type DisputeRow, type DisputeStatus } from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { EmptyState, Loading } from "./ui";

const money = (cents?: number | null) =>
  cents === undefined || cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;

const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : "—");

const VIEWS: { status: DisputeStatus; label: string }[] = [
  { status: "under_review", label: "To decide" },
  { status: "open", label: "Waiting for reply" },
  { status: "awaiting_funds", label: "Awaiting funds" },
  { status: "resolved", label: "Resolved" },
  { status: "withdrawn", label: "Withdrawn" },
];

const KIND_LABEL: Record<string, string> = {
  not_received: "Paid, didn't receive",
  wrong_amount: "Wrong amount",
  unauthorised: "Didn't make this payment",
  refund_not_given: "Promised refund never came",
  cash_not_given: "Agent didn't hand over cash",
  cash_given_not_credited: "Cash given, top-up not credited",
  wrong_recipient: "Sent to the wrong person",
  other: "Something else",
};

/** "overdue 2d" / "in 5h" against a deadline. */
function due(ms?: number | null) {
  if (!ms) return null;
  const hours = Math.round((ms - Date.now()) / 3_600_000);
  const span = Math.abs(hours) < 24 ? `${Math.abs(hours)}h` : `${Math.round(Math.abs(hours) / 24)}d`;
  return { text: hours < 0 ? `overdue ${span}` : `in ${span}`, late: hours < 0 };
}

/**
 * Disputes desk.
 *
 * Upholding posts money: a full counter payment is refunded exactly
 * (merchant net, platform fee, customer gross); anything else is an
 * adjustment from the other party, or from Zapp when "Zapp pays" is chosen.
 * If the other party can't cover it the dispute moves to Awaiting funds, the
 * amount is reserved in their wallet, and it settles by itself when they
 * have the money (decision D8).
 */
export function DisputeDesk() {
  const [view, setView] = useState<DisputeStatus>("under_review");
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listDisputes(view));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load disputes");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="split">
        <div className="panel">
          <div className="panel-head">
            <select
              value={view}
              onChange={(e) => {
                setView(e.target.value as DisputeStatus);
                setSelected(undefined);
              }}
              aria-label="Dispute status"
            >
              {VIEWS.map((v) => (
                <option key={v.status} value={v.status}>
                  {v.label}
                </option>
              ))}
            </select>
            <div className="spacer" />
            <button className="ghost" onClick={() => void load()} aria-label="Refresh">
              <Icon name="refresh" size={16} />
            </button>
          </div>

          {loading ? (
            <Loading />
          ) : error ? null : rows.length === 0 ? (
            <EmptyState icon="flag" title={view === "under_review" ? "Nothing to decide" : "Nothing here"} />
          ) : (
            <div className="list">
              {rows.map((d) => {
                const deadline = due(view === "open" ? d.respondBy : d.resolveBy);
                return (
                  <button
                    key={d.id}
                    className={`item${d.id === selected ? " selected" : ""}`}
                    onClick={() => setSelected(d.id)}
                  >
                    <div className="item-text">
                      <div className="name">
                        {money(d.amountCents)} · {KIND_LABEL[d.kind] ?? d.kind}
                      </div>
                      <div className="sub">
                        {d.disputedKind.replace(/_/g, " ")} · {when(d.createdAt)}
                        {deadline && (view === "open" || view === "under_review") && (
                          <span style={{ color: deadline.late ? "var(--danger)" : undefined }}>
                            {" "}
                            · {deadline.text}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selected ? (
          <DisputeDetailPanel
            key={selected}
            disputeId={selected}
            onDecided={async (message) => {
              setNotice(message);
              setSelected(undefined);
              await load();
            }}
          />
        ) : (
          <div className="panel">
            <EmptyState icon="flag" title="No dispute selected">
              Pick a dispute to see both sides, the money and the thread.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function DisputeDetailPanel({
  disputeId,
  onDecided,
}: {
  disputeId: string;
  onDecided: (message: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<"upheld" | "rejected" | null>(null);
  const [amount, setAmount] = useState("");
  const [payFrom, setPayFrom] = useState<"counterparty" | "platform">("counterparty");

  useEffect(() => {
    api
      .getDispute(disputeId)
      .then((d) => {
        setDetail(d);
        setAmount((d.dispute.amountCents / 100).toFixed(2));
        setPayFrom(d.dispute.against ? "counterparty" : "platform");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load dispute"));
  }, [disputeId]);

  if (error) return <div className="banner error">{error}</div>;
  if (!detail)
    return (
      <div className="panel">
        <Loading />
      </div>
    );

  const d = detail.dispute;
  const decidable = d.status === "open" || d.status === "under_review";
  const amountCents = Math.round(parseFloat(amount || "0") * 100);
  const amountValid = amountCents > 0 && amountCents <= d.transactionAmountCents;
  const fullRefund =
    payFrom === "counterparty" && d.disputedKind === "shop_payment" && amountCents === d.transactionAmountCents;

  const decide = async (reason: string) => {
    if (!deciding) return;
    const res = await api.resolveDispute({
      disputeId,
      outcome: deciding,
      reason,
      ...(deciding === "upheld" ? { amountCents, payFrom } : {}),
    });
    setDeciding(null);
    await onDecided(
      deciding === "rejected"
        ? "Dispute rejected. Both sides have been told."
        : res.status === "awaiting_funds"
          ? `Upheld. The other party is short, so ${money(res.owedCents)} is reserved in their wallet and pays out when they have it.`
          : `Upheld: ${money(amountCents)} returned by ${res.remedy}.`
    );
  };

  const party = (label: string, p: DisputeDetail["raiser"]) => (
    <>
      <dt>{label}</dt>
      <dd>
        {p ? (
          <>
            {p.fullName || "(no name)"} · {p.accountType || "customer"}
            <div className="muted">
              {p.phoneNumber || p.uid} · balance {money(p.balanceCents)}
              {p.reservedCents > 0 && ` · ${money(p.reservedCents)} reserved`}
            </div>
          </>
        ) : (
          <span className="muted">Nobody to answer (goes straight to ops)</span>
        )}
      </dd>
    </>
  );

  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="panel-head">
          <h2>
            {money(d.amountCents)} · {KIND_LABEL[d.kind] ?? d.kind}
          </h2>
          <div className="spacer" />
          <span className={`badge ${d.status === "resolved" ? "ok" : d.status === "withdrawn" ? "" : "warn"}`}>
            {d.status.replace(/_/g, " ")}
          </span>
        </div>

        <dl className="kv">
          {party("Raised by", detail.raiser)}
          {party("Against", detail.against)}
          <dt>Movement</dt>
          <dd>
            {d.disputedKind.replace(/_/g, " ")} of {money(d.transactionAmountCents)}
            <div className="muted">
              {d.transactionId ? `transaction ${d.transactionId}` : `top-up request ${d.agentTopupRequestId}`}
              {detail.transaction?.createdAt ? ` · ${when(detail.transaction.createdAt)}` : ""}
              {detail.transaction?.refundedAt ? " · already refunded" : ""}
            </div>
          </dd>
          <dt>Deadlines</dt>
          <dd>
            Reply by {when(d.respondBy)}
            <div className="muted">Resolve by {when(d.resolveBy)}</div>
          </dd>
          {d.owedCents ? (
            <>
              <dt>Owed</dt>
              <dd>{money(d.owedCents)} reserved in the other party's wallet</dd>
            </>
          ) : null}
          {d.resolution ? (
            <>
              <dt>Decision</dt>
              <dd>
                {d.resolution.outcome} · {money(d.resolution.amountCents)} by {d.resolution.remedy}
                {d.resolution.payFrom === "platform" ? " (Zapp paid)" : ""}
                <div className="muted">
                  {d.resolution.reason} · {when(d.resolution.decidedAt)}
                  {d.resolution.settledAt ? ` · settled ${when(d.resolution.settledAt)}` : " · not settled yet"}
                </div>
              </dd>
            </>
          ) : null}
        </dl>

        <h3>Thread</h3>
        <div className="stack" style={{ marginTop: 10 }}>
          {d.messages.map((m, i) => (
            <div key={i} className="thread-msg" data-role={m.role}>
              <div className="muted">
                {m.role === "raiser" ? "Raised by" : m.role === "counterparty" ? "Other party" : "Zapp Pay"} ·{" "}
                {when(m.at)}
              </div>
              <div>{m.text}</div>
            </div>
          ))}
        </div>

        {decidable && (
          <>
            <h3>Decide</h3>
            <div className="row wrap" style={{ marginTop: 10 }}>
              <button className="primary" onClick={() => setDeciding("upheld")}>
                <Icon name="check" size={16} />
                Uphold
              </button>
              <button className="danger" onClick={() => setDeciding("rejected")}>
                Reject
              </button>
            </div>
          </>
        )}
      </div>

      {deciding === "rejected" && (
        <ReasonPrompt
          title="Reject this dispute"
          description="No money moves. Both sides see the reason, so write it for them."
          confirmLabel="Reject"
          danger
          onConfirm={decide}
          onCancel={() => setDeciding(null)}
        />
      )}

      {deciding === "upheld" && (
        <ReasonPrompt
          title={`Uphold: return ${money(amountValid ? amountCents : 0)}`}
          description={
            fullRefund
              ? "The whole payment is refunded exactly: the merchant returns their net, Zapp returns its fee. Both sides see the reason."
              : payFrom === "platform"
                ? "Zapp pays this from platform fees. Use it when there's nobody to recover it from. Both sides see the reason."
                : "The amount moves from the other party to the customer. If they can't cover it, it is reserved in their wallet and paid when they can. Both sides see the reason."
          }
          confirmLabel="Uphold and pay"
          confirmDisabled={!amountValid}
          onConfirm={decide}
          onCancel={() => setDeciding(null)}
        >
          <label className="stack">
            <span className="muted">Amount to return (up to {money(d.transactionAmountCents)})</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="stack" style={{ marginTop: 12 }}>
            <span className="muted">Who pays</span>
            <select value={payFrom} onChange={(e) => setPayFrom(e.target.value as typeof payFrom)}>
              <option value="counterparty" disabled={!d.against}>
                The other party
              </option>
              <option value="platform">Zapp (platform fees)</option>
            </select>
          </label>
        </ReasonPrompt>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  api,
  formatFloat,
  type DisputeRow,
  type FloatIssuanceRow,
  type HeldPayment,
  type KycQueueRow,
  type PayoutRow,
  type RoleRequestRow,
  type ZaadTopupRow,
} from "../api";
import { DecisionsPanel } from "./AgentZaadDesk";
import { DisputeDetailPanel, KIND_LABEL } from "./DisputeDesk";
import { Icon, type IconName } from "./Icon";
import { SubmissionView } from "./KycQueue";
import { ReasonPrompt } from "./ReasonPrompt";
import { RoleApplicationView } from "./RoleApplicationView";
import { Loading } from "./ui";

/**
 * Everything waiting on Zapp for one account, across every desk, decided in
 * place. Each list comes from the same `admin*` callable its desk uses and is
 * filtered to this uid here, so nothing new is exposed and every decision goes
 * through the same audited callable as on the desk.
 */

interface Found {
  roles: RoleRequestRow[];
  kyc: KycQueueRow[];
  float: FloatIssuanceRow[];
  payouts: PayoutRow[];
  disputes: DisputeRow[];
  zaad: ZaadTopupRow[];
  held: HeldPayment[];
}

const EMPTY: Found = { roles: [], kyc: [], float: [], payouts: [], disputes: [], zaad: [], held: [] };

const OPEN_DISPUTES = ["under_review", "open", "awaiting_funds"] as const;

type Prompt =
  | { kind: "float"; row: FloatIssuanceRow; decision: "approve" | "reject" }
  | { kind: "payoutSent"; row: PayoutRow }
  | { kind: "payoutDecline"; row: PayoutRow }
  | { kind: "held"; row: HeldPayment };

function tsMs(ts?: { _seconds?: number; seconds?: number } | null): number | null {
  const s = ts?._seconds ?? ts?.seconds;
  return typeof s === "number" ? s * 1000 : null;
}

function when(ms: number | null | undefined) {
  return ms ? new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
}

function Item({
  icon,
  title,
  sub,
  tone,
  children,
}: {
  icon: IconName;
  title: ReactNode;
  sub?: ReactNode;
  tone?: "warn" | "bad";
  children?: ReactNode;
}) {
  return (
    <div className="work-item" data-tone={tone}>
      <span className="work-icon">
        <Icon name={icon} size={18} />
      </span>
      <div className="work-text">
        <div className="work-title">{title}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="row wrap work-actions">{children}</div>
    </div>
  );
}

export function AccountWork({
  userId,
  name,
  adminUid,
  canReview,
  canRunFloat,
  onChanged,
}: {
  userId: string;
  name: string;
  adminUid: string;
  canReview: boolean;
  canRunFloat: boolean;
  /** After any decision: the page reloads balances and shows the message. */
  onChanged: (message: string) => Promise<void>;
}) {
  const [found, setFound] = useState<Found | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    const none = <T,>() => Promise.resolve([] as T[]);
    const jobs = {
      roles: canReview ? api.listRoleRequests("pending").then((r) => r.filter((x) => x.userId === userId)) : none<RoleRequestRow>(),
      kyc: canReview ? api.listKycQueue("submitted").then((r) => r.filter((x) => x.userId === userId)) : none<KycQueueRow>(),
      float: canRunFloat ? api.listFloatIssuances("pending").then((r) => r.filter((x) => x.agentId === userId)) : none<FloatIssuanceRow>(),
      payouts: canRunFloat ? api.listPayouts("requested").then((r) => r.filter((x) => x.merchantId === userId)) : none<PayoutRow>(),
      disputes: canRunFloat
        ? Promise.all(OPEN_DISPUTES.map((s) => api.listDisputes(s))).then((lists) =>
            lists.flat().filter((d) => d.raisedBy === userId || d.against === userId)
          )
        : none<DisputeRow>(),
      zaad: canRunFloat
        ? api.listZaadTopups("attention").then((r) => r.topups.filter((x) => x.customerId === userId || x.agentId === userId))
        : none<ZaadTopupRow>(),
      held: canRunFloat ? api.listHeldMobileMoney().then((r) => r.filter((x) => x.suggestedUid === userId)) : none<HeldPayment>(),
    };
    const keys = Object.keys(jobs) as (keyof Found)[];
    const settled = await Promise.allSettled(keys.map((k) => jobs[k]));
    const next: Found = { ...EMPTY };
    const failed: string[] = [];
    settled.forEach((res, i) => {
      if (res.status === "fulfilled") (next as unknown as Record<string, unknown[]>)[keys[i]] = res.value;
      else failed.push(`${keys[i]}: ${res.reason instanceof Error ? res.reason.message : "could not load"}`);
    });
    setFound(next);
    setErrors(failed);
  }, [userId, canReview, canRunFloat]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string) => {
    setPrompt(null);
    setExpanded(null);
    setReference("");
    await Promise.all([load(), onChanged(message)]);
  };

  const confirm = async (reason: string) => {
    if (!prompt) return;
    switch (prompt.kind) {
      case "float":
        if (prompt.decision === "approve") {
          await api.approveFloat(prompt.row.issuanceId, reason);
          return done(`Posted ${formatFloat(prompt.row.amountCents, prompt.row.currency)} float ${prompt.row.direction}.`);
        }
        await api.rejectFloat(prompt.row.issuanceId, reason);
        return done("Float request rejected. Nothing was posted.");
      case "payoutSent":
        await api.settlePayout(prompt.row.id, reference.trim(), reason);
        return done(`Recorded the ${formatFloat(prompt.row.amountCents, prompt.row.currency)} payout as sent.`);
      case "payoutDecline":
        await api.rejectPayout(prompt.row.id, reason);
        return done("Payout declined and returned to the balance.");
      case "held":
        await api.assignMobileMoney(prompt.row.receiptId, userId, reason);
        return done(`${formatFloat(prompt.row.amountCents, prompt.row.currency === "SLS" ? "SLS" : "USD")} credited to ${name}.`);
    }
  };

  if (!found) {
    return (
      <div className="panel">
        <Loading label="Checking every desk for this account…" />
      </div>
    );
  }

  const count =
    found.roles.length +
    found.kyc.length +
    found.float.length +
    found.payouts.length +
    found.disputes.length +
    found.zaad.length +
    found.held.length;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Waiting on Zapp</h2>
        {count > 0 && <span className="badge warn">{count}</span>}
        <div className="spacer" />
        <button className="ghost" onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          Refresh
        </button>
      </div>

      {errors.length > 0 && (
        <div className="banner error">Some desks could not be checked, so this may not be everything: {errors.join("; ")}</div>
      )}

      {count === 0 ? (
        errors.length === 0 && (
          <p className="hint">
            <Icon name="check" size={14} /> Nothing open for this account on any desk.
          </p>
        )
      ) : (
        <div className="stack" style={{ marginTop: 10 }}>
          {/* An ID sent with a role application is decided with the application. */}
          {(found.roles.some((r) => r.applicationSubmitted) ? [] : found.kyc).map((k) => (
            <div key={`kyc-${k.userId}`}>
              <Item
                icon="idcard"
                title="ID documents to check"
                sub={`Submitted ${when(tsMs(k.submittedAt)) ?? "—"}${k.idType ? ` · ${k.idType.replace(/_/g, " ")}` : ""}`}
              >
                <button
                  className={expanded === "kyc" ? "ghost" : "primary"}
                  onClick={() => setExpanded(expanded === "kyc" ? null : "kyc")}
                >
                  {expanded === "kyc" ? "Hide" : "Review ID"}
                </button>
              </Item>
              {expanded === "kyc" && (
                <div className="work-expand">
                  <SubmissionView userId={userId} compact onDecided={(m) => void done(m)} />
                </div>
              )}
            </div>
          ))}

          {found.roles.map((r) => {
            const key = `role-${r.requestId}`;
            return (
              <div key={key}>
                <Item
                  icon="briefcase"
                  title={`Wants to be ${r.requestedRole.replace(/_/g, " ")}`}
                  sub={
                    (r.applicationSubmitted ? "Full application sent · " : "Still filling in the application · ") +
                    ([r.businessName, r.area].filter(Boolean).join(" · ") || `Currently ${r.currentAccountType || "customer"}`)
                  }
                >
                  <button
                    className={expanded === key ? "ghost" : "primary"}
                    onClick={() => setExpanded(expanded === key ? null : key)}
                  >
                    {expanded === key ? "Hide" : "Review application"}
                  </button>
                </Item>
                {expanded === key && (
                  <div className="work-expand">
                    <RoleApplicationView requestId={r.requestId} showApplicant={false} onDecided={done} />
                  </div>
                )}
              </div>
            );
          })}

          {found.float.map((f) => {
            const blocked = f.requiresSecondApprover && f.requestedBy === adminUid;
            return (
              <Item
                key={f.issuanceId}
                icon="banknote"
                title={`Float ${f.direction}: ${formatFloat(f.amountCents, f.currency)}`}
                sub={`${f.route}${f.externalReference ? ` · ${f.externalReference}` : ""} · asked by ${f.requestedByEmail}${
                  f.requiresSecondApprover ? " · needs a 2nd approver" : ""
                }`}
              >
                <button
                  className="primary"
                  disabled={blocked}
                  title={blocked ? "You raised this request; it needs a different admin" : undefined}
                  onClick={() => setPrompt({ kind: "float", row: f, decision: "approve" })}
                >
                  Approve
                </button>
                <button className="danger" onClick={() => setPrompt({ kind: "float", row: f, decision: "reject" })}>
                  Reject
                </button>
              </Item>
            );
          })}

          {found.payouts.map((p) => (
            <Item
              key={p.id}
              icon="send"
              title={`Payout to send: ${formatFloat(p.amountCents, p.currency)}`}
              sub={`${p.route} · ${p.destinationName} (${p.destinationRef})${p.auto ? " · automatic" : ""}${
                p.requiresSeniorApproval ? " · needs a senior admin" : ""
              }`}
              tone={p.requiresSeniorApproval ? "warn" : undefined}
            >
              <button
                onClick={() => {
                  setReference("");
                  setPrompt({ kind: "payoutSent", row: p });
                }}
              >
                Mark sent
              </button>
              <button className="ghost" onClick={() => setPrompt({ kind: "payoutDecline", row: p })}>
                Decline
              </button>
            </Item>
          ))}

          {found.disputes.map((d) => {
            const key = `dispute-${d.id}`;
            const late = d.resolveBy != null && d.resolveBy < Date.now();
            return (
              <div key={key}>
                <Item
                  icon="flag"
                  tone={late ? "bad" : undefined}
                  title={`Dispute: ${formatFloat(d.amountCents, d.currency)} · ${KIND_LABEL[d.kind] ?? d.kind}`}
                  sub={`${d.raisedBy === userId ? "Raised by this account" : "Against this account"} · ${d.status.replace(/_/g, " ")}${
                    late ? " · past its deadline" : ""
                  }`}
                >
                  <button
                    className={expanded === key ? "ghost" : "primary"}
                    onClick={() => setExpanded(expanded === key ? null : key)}
                  >
                    {expanded === key ? "Hide" : "Open"}
                  </button>
                </Item>
                {expanded === key && (
                  <div className="work-expand">
                    <DisputeDetailPanel disputeId={d.id} onDecided={done} />
                  </div>
                )}
              </div>
            );
          })}

          {found.held.map((h) => (
            <Item
              key={h.receiptId}
              icon="inbox"
              title={`Held ${h.provider === "zaad" ? "Zaad" : "eDahab"} payment: ${formatFloat(h.amountCents, h.currency === "SLS" ? "SLS" : "USD")}`}
              sub={`From ${h.senderName ? `${h.senderName}, ` : ""}${h.senderMsisdn} · ${h.reason.replace(/_/g, " ")} · ${
                when(h.receivedAt) ?? ""
              } · matched to this account`}
            >
              <button className="primary" onClick={() => setPrompt({ kind: "held", row: h })}>
                Credit this account
              </button>
            </Item>
          ))}

          {found.zaad.length > 0 && (
            <div className="work-expand">
              <DecisionsPanel forUid={userId} onNotice={(m) => void done(m)} />
            </div>
          )}
        </div>
      )}

      {prompt?.kind === "float" && (
        <ReasonPrompt
          title={
            prompt.decision === "approve"
              ? `Approve ${formatFloat(prompt.row.amountCents, prompt.row.currency)} ${prompt.row.direction}`
              : "Reject this request"
          }
          description={
            prompt.decision === "approve"
              ? `This posts to the ledger immediately and ${prompt.row.direction === "issue" ? "credits" : "debits"} ${name}'s float. It cannot be edited afterwards — corrections are new entries.`
              : "Nothing is posted. The requester can raise a new request."
          }
          confirmLabel={prompt.decision === "approve" ? "Approve and post" : "Reject"}
          danger={prompt.decision === "reject"}
          onConfirm={confirm}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === "payoutSent" && (
        <ReasonPrompt
          title={`Mark ${formatFloat(prompt.row.amountCents, prompt.row.currency)} as sent`}
          description={`Send the money first, on ${prompt.row.route}, to ${prompt.row.destinationName} (${prompt.row.destinationRef}). Then enter the transfer reference — without it this payout cannot be matched to a statement later.`}
          confirmLabel="Record as sent"
          confirmDisabled={reference.trim().length < 3}
          onConfirm={confirm}
          onCancel={() => setPrompt(null)}
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

      {prompt?.kind === "payoutDecline" && (
        <ReasonPrompt
          title={`Decline ${formatFloat(prompt.row.amountCents, prompt.row.currency)}`}
          description="The money goes straight back to the merchant's balance, and they are told why — so write the reason for them, not for us."
          confirmLabel="Decline and return"
          danger
          onConfirm={confirm}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === "held" && (
        <ReasonPrompt
          title={`Credit ${formatFloat(prompt.row.amountCents, prompt.row.currency === "SLS" ? "SLS" : "USD")} to ${name}`}
          description={`Zapp received this on ${prompt.row.provider === "zaad" ? "Zaad" : "eDahab"} from ${prompt.row.senderMsisdn} (${prompt.row.operatorTxnId}) and matched it to this account. Only credit it once you're sure it's theirs.`}
          confirmLabel="Credit wallet"
          onConfirm={confirm}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}

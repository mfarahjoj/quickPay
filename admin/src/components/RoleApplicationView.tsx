import { useCallback, useEffect, useState } from "react";
import { api, type RoleApplicationDetail } from "../api";
import { AccountLink } from "./AccountLink";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { Loading } from "./ui";

const ROLE_LABEL: Record<string, string> = {
  merchant: "Merchant (shop)",
  topup_agent: "Top-up agent",
  agent_merchant: "Shop and agent",
};

const ID_LABEL: Record<string, string> = {
  national_id: "National ID",
  passport: "Passport",
  drivers_license: "Driving licence",
};

const PHOTO_LABEL: Record<string, string> = {
  shop: "Shop",
  front: "ID front",
  back: "ID back",
  selfie: "Selfie",
};

const SERVICE_LABEL: Record<string, string> = { cash_in: "Cash in", cash_out: "Cash out" };

/** "+252634123456" → "063 412 3456". */
function local(msisdn?: string | null) {
  if (!msisdn) return "—";
  const m = /^\+252(\d{2})(\d{3})(\d{4})$/.exec(msisdn);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : msisdn;
}

/**
 * One merchant / agent application, everything on one screen, decided once.
 * Approving sets up the role, the merchant profile and payout account, the
 * agent's hours and Zaad receiving number, and verifies the ID (server side,
 * in one transaction: adminReviewRoleRequest).
 */
export function RoleApplicationView({
  requestId,
  onDecided,
  showApplicant = true,
}: {
  requestId: string;
  onDecided: (message: string) => void | Promise<void>;
  /** False on the account page, which already shows who this is. */
  showApplicant?: boolean;
}) {
  const [detail, setDetail] = useState<RoleApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [idNumber, setIdNumber] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.getRoleApplication(requestId);
      setDetail(d);
      setIdNumber(d.kyc?.idNumber ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the application");
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="banner error">{error}</div>;
  if (!detail) return <Loading label="Loading the application…" />;

  const app = detail.application;
  const name = detail.applicant.fullName || "the applicant";
  const role = ROLE_LABEL[detail.requestedRole] ?? detail.requestedRole;
  const decided = detail.status !== "pending";

  const willDo: string[] = [`Make ${name} a ${role.toLowerCase()}`];
  if (app?.payout) willDo.push(`Create the shop profile, paying out to ${app.payout.provider === "zaad" ? "Zaad" : "eDahab"} ${local(app.payout.number)}`);
  if (app?.agent) willDo.push("Set them up as an agent for cash in and cash out");
  if (app?.agent?.zaadReceiveNumber) willDo.push(`Switch on Zaad top-ups, receiving on ${local(app.agent.zaadReceiveNumber)}`);
  if (detail.kyc?.fromApplication && detail.kyc.status === "submitted") willDo.push("Verify their ID (no separate KYC review)");
  willDo.push("Tell them in the app, in their language");

  const decide = async (reason: string) => {
    if (!decision) return;
    await api.reviewRoleRequest(requestId, decision, reason, decision === "approve" ? idNumber.trim() || undefined : undefined);
    setDecision(null);
    await onDecided(
      decision === "approve"
        ? `${name} approved as ${role.toLowerCase()}. Everything is set up.`
        : `${name}'s application was rejected. They can fix it and send it again.`
    );
  };

  return (
    <div className="stack-lg">
      {showApplicant && (
        <div className="row wrap">
          <h2 style={{ margin: 0 }}>
            <AccountLink uid={detail.userId}>{detail.applicant.fullName || "(no name)"}</AccountLink>
          </h2>
          <span className="badge">{role}</span>
          <span className="muted">{detail.applicant.phoneNumber}</span>
        </div>
      )}

      {!app ? (
        <div className="banner">
          This request came from an older app version, so there is no full application: no business details, payout
          account or ID with it. Approving grants the role only, as before.
        </div>
      ) : (
        <>
          <div className="photos">
            {detail.images.map((img) => (
              <figure key={img.label} className="photo">
                {img.url ? (
                  <a href={img.url} target="_blank" rel="noreferrer noopener">
                    <img src={img.url} alt={PHOTO_LABEL[img.label]} />
                  </a>
                ) : (
                  <div className="photo-missing">{img.error || "Not provided"}</div>
                )}
                <figcaption>{PHOTO_LABEL[img.label]}</figcaption>
              </figure>
            ))}
          </div>
          <p className="hint">Photo links expire after 15 minutes. Reload if they stop showing.</p>

          <h3>Business</h3>
          <dl className="kv">
            <dt>Name</dt>
            <dd>{app.businessName}</dd>
            <dt>Type</dt>
            <dd>{app.businessType}</dd>
            <dt>Address</dt>
            <dd>
              {app.businessAddress || <span className="muted">No landmark given; use the map pin</span>}
              {app.area && <div className="muted">{app.area}</div>}
            </dd>
            <dt>Location</dt>
            <dd>
              {app.location ? (
                <>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${app.location.lat},${app.location.lng}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open in Maps
                  </a>
                  <span className="muted">
                    {" "}
                    · {app.location.lat.toFixed(5)}, {app.location.lng.toFixed(5)}
                    {app.location.accuracyM != null ? ` · ±${app.location.accuracyM} m` : ""}
                  </span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </dl>

          {app.payout && (
            <>
              <h3>Payouts</h3>
              <dl className="kv">
                <dt>Paid to</dt>
                <dd>
                  {app.payout.provider === "zaad" ? "Zaad" : "eDahab"} · {local(app.payout.number)}
                  <div className="muted">Check it's in {name}'s own name.</div>
                </dd>
              </dl>
            </>
          )}

          {app.agent && (
            <>
              <h3>Agent</h3>
              <dl className="kv">
                <dt>Hours</dt>
                <dd>{app.agent.openHours || <span className="muted">Not given (they can add them in the app)</span>}</dd>
                <dt>Services</dt>
                <dd>{app.agent.services.map((s) => SERVICE_LABEL[s] ?? s).join(", ")}</dd>
                <dt>Zaad receiving number</dt>
                <dd>
                  {app.agent.zaadReceiveNumber ? local(app.agent.zaadReceiveNumber) : "None (no online Zaad top-ups)"}
                </dd>
              </dl>
            </>
          )}

          <h3>Identity</h3>
          <dl className="kv">
            {detail.kyc ? (
              <>
                <dt>ID</dt>
                <dd>
                  {ID_LABEL[detail.kyc.idType] ?? detail.kyc.idType}
                  {detail.kyc.idNumber ? (
                    <>
                      {" "}
                      · <span className="mono">{detail.kyc.idNumber}</span>
                    </>
                  ) : (
                    <span className="muted"> · number not typed in: read it off the photo</span>
                  )}
                </dd>
                <dt>KYC</dt>
                <dd>{detail.kyc.status}</dd>
              </>
            ) : (
              <>
                <dt>KYC</dt>
                <dd>{detail.applicant.kycStatus ?? "—"}</dd>
              </>
            )}
          </dl>
        </>
      )}

      {decided ? (
        <div className="banner">This application was already {detail.status}.</div>
      ) : (
        <>
          <div className="stack" style={{ gap: 4 }}>
            <strong>Approving will:</strong>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {willDo.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <div className="row wrap">
            <button className="primary" onClick={() => setDecision("approve")}>
              <Icon name="check" size={16} />
              Approve and set up
            </button>
            <button className="danger" onClick={() => setDecision("reject")}>
              Reject
            </button>
            <button className="ghost" onClick={() => void load()}>
              <Icon name="refresh" size={16} />
              Reload
            </button>
          </div>
        </>
      )}

      {decision && (
        <ReasonPrompt
          title={decision === "approve" ? `Approve ${name}` : `Reject ${name}'s application`}
          description={
            decision === "approve"
              ? "Everything above happens at once. Only approve once the photos match the person and the payout number is theirs."
              : "Nothing is set up. The reason is shown to the applicant, who can fix it and send the application again, so write it for them."
          }
          confirmLabel={decision === "approve" ? "Approve and set up" : "Reject"}
          danger={decision === "reject"}
          onConfirm={decide}
          onCancel={() => setDecision(null)}
        >
          {decision === "approve" && (
            <label className="stack" style={{ marginBottom: 12 }}>
              <span className="muted">ID number, from the photo</span>
              <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} autoComplete="off" />
              <span className="muted">Lets them reset a forgotten PIN in the app with its last 4 characters.</span>
            </label>
          )}
        </ReasonPrompt>
      )}
    </div>
  );
}

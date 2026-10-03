import { useCallback, useEffect, useState } from "react";
import { api, type KycQueueRow, type KycSubmission } from "../api";
import { Icon } from "./Icon";
import { ReasonPrompt } from "./ReasonPrompt";
import { Avatar, EmptyState, Loading } from "./ui";

function secondsOf(ts?: { _seconds?: number; seconds?: number }) {
  return ts?._seconds ?? ts?.seconds;
}

function when(ts?: { _seconds?: number; seconds?: number }) {
  const secs = secondsOf(ts);
  return secs ? new Date(secs * 1000).toLocaleString() : "—";
}

/** How long someone has been waiting — the reason the queue is oldest-first. */
function waitingFor(ts?: { _seconds?: number; seconds?: number }) {
  const secs = secondsOf(ts);
  if (!secs) return null;
  const hours = Math.floor((Date.now() / 1000 - secs) / 3600);
  if (hours < 1) return { label: "new", stale: false };
  if (hours < 24) return { label: `${hours}h`, stale: false };
  return { label: `${Math.floor(hours / 24)}d`, stale: hours >= 48 };
}

const ID_LABEL: Record<string, string> = {
  national_id: "National ID",
  passport: "Passport",
  drivers_license: "Driving licence",
};

function SubmissionView({
  userId,
  onDecided,
}: {
  userId: string;
  onDecided: (message: string) => void;
}) {
  const [submission, setSubmission] = useState<KycSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubmission(await api.getKycSubmission(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the submission");
      setSubmission(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (reason: string) => {
    if (!decision) return;
    await api.reviewKyc(userId, decision, reason);
    onDecided(
      decision === "approve" ? "Identity verified." : "Submission rejected."
    );
    setDecision(null);
  };

  if (loading)
    return (
      <div className="panel">
        <Loading />
      </div>
    );
  if (error) return <div className="banner error">{error}</div>;
  if (!submission) return null;

  const { applicant, wallet } = submission;

  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="person-head">
          <Avatar name={applicant.fullName} size={56} />
          <div className="person-text">
            <div className="row">
              <h2>{applicant.fullName || "(no name)"}</h2>
              <span className={`badge ${applicant.accountStatus ?? "active"}`}>
                {applicant.accountStatus}
              </span>
            </div>
            <div className="sub">{applicant.phoneNumber || "(no phone)"}</div>
          </div>
        </div>

        <h3>Submitted documents</h3>
        <dl className="kv">
          <dt>ID type</dt>
          <dd>{ID_LABEL[submission.idType ?? ""] ?? submission.idType ?? "—"}</dd>
          <dt>ID number</dt>
          <dd>{submission.idNumber || "—"}</dd>
          <dt>Submitted</dt>
          <dd>{when(submission.submittedAt)}</dd>
        </dl>

        <h3>Applicant</h3>
        <dl className="kv">
          <dt>Phone</dt>
          <dd>{applicant.phoneNumber || "—"}</dd>
          <dt>Date of birth</dt>
          <dd>{applicant.dateOfBirth || "—"}</dd>
          <dt>Account type</dt>
          <dd>{applicant.accountType || "customer"}</dd>
          <dt>Wallet balance</dt>
          <dd>
            {wallet
              ? `${wallet.currency ?? "USD"} ${((wallet.balance ?? 0) / 100).toFixed(2)}`
              : "no wallet"}
          </dd>
        </dl>

        <h3>Photos</h3>
        <p className="hint">
          Links are signed and expire after 15 minutes. Reload the submission if
          the images stop loading.
        </p>
        <div className="photos">
          {submission.images.map((img) => (
            <figure key={img.label} className="photo">
              {img.url ? (
                <a href={img.url} target="_blank" rel="noreferrer noopener">
                  <img src={img.url} alt={`${img.label} of ID document`} />
                </a>
              ) : (
                <div className="photo-missing">{img.error || "Not provided"}</div>
              )}
              <figcaption>{img.label}</figcaption>
            </figure>
          ))}
        </div>

        <h3>Decision</h3>
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button className="primary" onClick={() => setDecision("approve")}>
            Verify identity
          </button>
          <button className="danger" onClick={() => setDecision("reject")}>
            Reject
          </button>
          <button className="ghost" onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            Reload
          </button>
        </div>
      </div>

      {decision && (
        <ReasonPrompt
          title={decision === "approve" ? "Verify this identity" : "Reject this submission"}
          description={
            decision === "approve"
              ? "Sets the account to verified, which raises its per-transaction cap."
              : "The reason is shown to the applicant so they can resubmit correctly."
          }
          confirmLabel={decision === "approve" ? "Verify" : "Reject"}
          danger={decision === "reject"}
          onConfirm={decide}
          onCancel={() => setDecision(null)}
        />
      )}
    </div>
  );
}

export function KycQueue() {
  const [rows, setRows] = useState<KycQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listKycQueue("submitted"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the queue");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack-lg">
      {notice && <div className="banner ok">{notice}</div>}

      <div className="split">
        <div className="panel">
          <div className="panel-head">
            <h2>Awaiting review</h2>
            {!loading && !error && <span className="badge">{rows.length}</span>}
            <div className="spacer" />
            <button className="ghost" onClick={() => void load()}>
              <Icon name="refresh" size={16} />
              Refresh
            </button>
          </div>
          <p className="hint">Oldest first.</p>

          {error && <div className="banner error">{error}</div>}

          {loading ? (
            <Loading />
          ) : error ? null : rows.length === 0 ? (
            <EmptyState icon="idcard" title="Nothing to review" />
          ) : (
            <div className="list">
              {rows.map((r) => {
                const age = waitingFor(r.submittedAt);
                return (
                  <button
                    key={r.userId}
                    className={`item${r.userId === selected ? " selected" : ""}`}
                    onClick={() => setSelected(r.userId)}
                  >
                    <Avatar name={r.applicantName} />
                    <div className="item-text">
                      <div className="row">
                        <span className="name">{r.applicantName || "(no name)"}</span>
                        <div className="spacer" />
                        {age && (
                          <span className={`badge ${age.stale ? "frozen" : ""}`}>
                            {age.label}
                          </span>
                        )}
                      </div>
                      <div className="sub">
                        {r.applicantPhone || "(no phone)"} ·{" "}
                        {ID_LABEL[r.idType ?? ""] ?? r.idType ?? "—"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selected ? (
          <SubmissionView
            key={selected}
            userId={selected}
            onDecided={async (message) => {
              setNotice(message);
              setSelected(undefined);
              await load();
            }}
          />
        ) : (
          <div className="panel">
            <EmptyState icon="idcard" title="No submission selected">
              Pick a submission to review.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

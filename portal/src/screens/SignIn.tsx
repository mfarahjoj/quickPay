import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { signInWithCustomToken } from "firebase/auth";
import { LoginStart, pollLogin, startLogin } from "../api";
import { auth, configError } from "../firebase";
import { LANGS, Lang, useI18n } from "../i18n";
import { LockIcon } from "../components/icons";

const POLL_MS = 2000;

type Status = "starting" | "waiting" | "declined" | "signingIn" | "error";

/**
 * The computer shows a QR; the shop scans it with Zapp Pay Merchant and
 * approves with the PIN; this page collects the sign-in with the secret only
 * it holds. The QR carries the login id and the approval code, never the
 * poll secret (functions/src/portal/login.ts).
 */
export function SignIn({ notice }: { notice?: string | null }) {
  const { t, lang, setLang } = useI18n();
  const [login, setLogin] = useState<LoginStart | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const generation = useRef(0);

  const begin = useCallback(async (next: Status = "starting") => {
    const gen = ++generation.current;
    setStatus(next);
    try {
      const l = await startLogin();
      if (gen !== generation.current) return;
      setLogin(l);
      if (next !== "declined") setStatus("waiting");
    } catch {
      if (gen === generation.current) setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!configError) begin();
    return () => {
      generation.current++;
    };
  }, [begin]);

  useEffect(() => {
    if (!login || status === "error" || status === "signingIn") return;
    const gen = generation.current;
    const timer = setInterval(async () => {
      try {
        const p = await pollLogin(login.loginId, login.pollSecret);
        if (gen !== generation.current) return;
        if (p.status === "approved") {
          clearInterval(timer);
          setStatus("signingIn");
          await signInWithCustomToken(auth, p.token);
        } else if (p.status === "expired") {
          begin("starting");
        } else if (p.status === "declined") {
          begin("declined");
        }
      } catch {
        if (gen === generation.current) setStatus("error");
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [login, status, begin]);

  const payload = login ? JSON.stringify({ type: "zapp_portal_login", v: 1, id: login.loginId, code: login.code }) : "";
  const statusText =
    status === "starting" ? t("signin.renewing") : status === "declined" ? t("signin.declined") : status === "signingIn" ? t("signin.signingIn") : status === "error" ? t("signin.error") : t("signin.waiting");

  return (
    <main className="signin">
      <div className="card signin-card">
        <div>
          <div className="brand">
            <img src="/icon.svg" alt="" />
            {t("brand")}
            <span className="spacer" />
            <select className="ghost" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("header.language")}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <h1>{t("signin.title")}</h1>
          <p style={{ color: "var(--text-2)", fontSize: 15, margin: 0 }}>{t("signin.subtitle")}</p>
          {notice && (
            <div className="notice" style={{ marginTop: 16 }}>
              {notice}
            </div>
          )}
          <ol>
            <li>{t("signin.step1")}</li>
            <li>{t("signin.step2")}</li>
            <li>{t("signin.step3")}</li>
          </ol>
          <div className="readonly-note">
            <LockIcon />
            <span>{t("signin.readOnly")}</span>
          </div>
        </div>
        <div>
          {configError ? (
            <div className="qr-box">{t("signin.notConfigured")}</div>
          ) : (
            <>
              <div className={`qr-box${status === "starting" || status === "signingIn" || status === "error" ? " dim" : ""}`} aria-label={t("signin.step3")} data-login={login?.loginId}>
                {payload && <QRCodeSVG value={payload} size={232} level="M" marginSize={0} />}
              </div>
              <div className="qr-status" role="status">
                {statusText}
              </div>
              {status === "error" && (
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <button className="primary" onClick={() => begin()}>
                    {t("signin.retry")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

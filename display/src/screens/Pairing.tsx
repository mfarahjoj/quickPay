/**
 * Pairing and ConfirmLink (COUNTER_DISPLAY_PLAN.md 5). The tablet shows a QR
 * and an 8-digit code; the merchant claims it from the app with their PIN; the
 * tablet then shows the shop's name and must be confirmed here. Until then no
 * state doc exists and no payment QR is ever shown.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmDisplayPairing,
  errorReason,
  pollDisplayPairing,
  startDisplayPairing,
  type StartPairing,
} from "../api";
import { QrTicket } from "./QrTicket";
import { formatCountdown, translate, type StringKey } from "../i18n";
import { unlockAudio } from "../kiosk/chime";
import type { DisplayCreds, Lang } from "../types";

const POLL_MS = 2000;
const RETRY_MS = 5000;

type Phase =
  | { kind: "starting" }
  | { kind: "offline" }
  | { kind: "waiting"; pairing: StartPairing }
  | { kind: "claimed"; pairing: StartPairing; merchantName: string }
  | { kind: "confirming"; pairing: StartPairing; merchantName: string };

export function Pairing({
  lang,
  notice,
  onPaired,
}: {
  lang: Lang;
  notice: StringKey | null;
  onPaired: (creds: DisplayCreds) => void;
}) {
  const t = (k: StringKey, p?: Record<string, string | number>) => translate(lang, k, p);
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [message, setMessage] = useState<StringKey | null>(notice);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  // Only the newest start may set the phase: a slower, older request must not win.
  const generation = useRef(0);

  const start = useCallback(async () => {
    const gen = ++generation.current;
    setPhase({ kind: "starting" });
    try {
      const sentAt = Date.now();
      const pairing = await startDisplayPairing();
      if (!alive.current || gen !== generation.current) return;
      setOffset(pairing.serverNowMs - (sentAt + Date.now()) / 2);
      setPhase({ kind: "waiting", pairing });
    } catch (err) {
      console.error("startDisplayPairing:", err);
      if (!alive.current || gen !== generation.current) return;
      setPhase({ kind: "offline" });
      window.setTimeout(() => alive.current && void start(), RETRY_MS);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void start();
    return () => {
      alive.current = false;
    };
  }, [start]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Poll while waiting; a new code when this one runs out.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const { pairing } = phase;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await pollDisplayPairing(pairing.pairingId, pairing.pairingSecret);
        if (stopped || !alive.current) return;
        if (res.status === "claimed" && res.merchantName) {
          setPhase({ kind: "claimed", pairing, merchantName: res.merchantName });
        } else if (res.status === "expired" || res.status === "declined" || res.status === "completed") {
          void start();
        }
      } catch (err) {
        if (stopped) return;
        const reason = errorReason(err);
        if (reason === "pairing_not_found") void start();
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase, start]);

  const answer = async (accept: boolean) => {
    if (phase.kind !== "claimed") return;
    unlockAudio(); // this tap is the gesture the Paid chime needs
    const { pairing, merchantName } = phase;
    setPhase({ kind: "confirming", pairing, merchantName });
    try {
      const res = await confirmDisplayPairing(pairing.pairingId, pairing.pairingSecret, accept);
      if (accept && res.status === "completed" && res.displayId && res.displaySecret && res.stateKey) {
        onPaired({ displayId: res.displayId, displaySecret: res.displaySecret, stateKey: res.stateKey });
        return;
      }
      void start();
    } catch (err) {
      console.error("confirmDisplayPairing:", err);
      // A lost reply is safe to retry: a second Yes in the window issues fresh credentials.
      if (accept && !errorReason(err)) {
        setPhase({ kind: "claimed", pairing, merchantName });
        return;
      }
      setMessage("confirm.failed");
      void start();
    }
  };

  if (phase.kind === "claimed" || phase.kind === "confirming") {
    const busy = phase.kind === "confirming";
    return (
      <main className="screen center confirm">
        <h1 className="confirm-title">{t("confirm.title", { shop: phase.merchantName })}</h1>
        <p className="muted">{t("confirm.body")}</p>
        <div className="confirm-actions">
          <button className="btn btn-secondary" disabled={busy} onClick={() => void answer(false)}>
            {t("confirm.no")}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void answer(true)}>
            {t("confirm.yes")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen split">
      <section className="split-qr">
        {phase.kind === "waiting" ? (
          <QrTicket
            value={JSON.stringify({ type: "zapp_display_pair", v: 1, id: phase.pairing.pairingId, code: phase.pairing.code })}
          />
        ) : (
          <div className="ticket ticket-empty" aria-hidden />
        )}
      </section>
      <section className="split-info">
        <h1>{t("pairing.title")}</h1>
        <p className="lead">{t("pairing.steps")}</p>
        {phase.kind === "waiting" && (
          <>
            <p className="label">{t("pairing.orType")}</p>
            <p className="pair-code" dir="ltr">
              {phase.pairing.code.slice(0, 4)} {phase.pairing.code.slice(4)}
            </p>
            <p className="muted">
              {t("pairing.newCodeIn", {
                time: formatCountdown(Math.max(0, Math.ceil((phase.pairing.expiresAtMs - (now + offset)) / 1000))),
              })}
            </p>
          </>
        )}
        {phase.kind === "starting" && <p className="muted">{t("pairing.starting")}</p>}
        {phase.kind === "offline" && <p className="warn">{t("pairing.offline")}</p>}
        {message && <p className="notice">{t(message)}</p>}
      </section>
    </main>
  );
}

/**
 * A paired tablet: live state, scanner input, Setup, kiosk behaviour.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { displayScanCustomer, displaySignOut, errorReason } from "./api";
import { useCounterState } from "./state/useCounterState";
import { viewModel, type Screen } from "./state/viewModel";
import { createHidAssembler } from "./scanner/hidScanner";
import { CameraScanner } from "./scanner/CameraScanner";
import { CounterScreen } from "./screens/CounterScreens";
import { Setup } from "./screens/Setup";
import { translate, isRtl, type StringKey } from "./i18n";
import { keepScreenOn } from "./kiosk/wakeLock";
import { playChime } from "./kiosk/chime";
import { shouldReload } from "./kiosk/version";
import { loadCachedIdle, markWakeHintSeen, saveSettings, wakeHintSeen, type Settings } from "./storage";
import type { DisplayCreds, Lang } from "./types";

const NOTICE_MS = 4000;
const LONG_PRESS_MS = 2000;

const SCAN_ERRORS: Record<string, StringKey> = {
  no_active_sale: "scan.noSale",
  not_a_zapp_code: "scan.notZapp",
  own_code: "scan.ownCode",
  already_paid: "scan.alreadyPaid",
  token_used: "scan.tokenUsed",
  token_invalid: "scan.tokenUsed",
  token_expired: "scan.tokenExpired",
};

interface Props {
  creds: DisplayCreds;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onUnlinked: () => void;
}

export function Counter({ creds, settings, onSettings, onUnlinked }: Props) {
  const live = useCounterState(creds);
  const [revokedLocally, setRevokedLocally] = useState(false);
  const [cachedIdle] = useState(loadCachedIdle);
  const view = viewModel({
    state: live.state,
    stateMissing: live.stateMissing,
    revoked: live.revoked || revokedLocally,
    cachedIdle,
    nowMs: live.nowMs,
    clockReady: live.clockReady,
  });

  const lang: Lang = settings.lang ?? live.state?.lang ?? cachedIdle?.lang ?? "en";
  const t = (k: StringKey, p?: Record<string, string | number>) => translate(lang, k, p);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
  }, [lang]);

  // ── Notices (scan feedback) ───────────────────────────────────────────────
  const [notice, setNotice] = useState<{ key: StringKey; tone: "info" | "warn" } | null>(null);
  const noticeTimer = useRef<number>();
  const showNotice = useCallback((key: StringKey, tone: "info" | "warn", ms = NOTICE_MS) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ key, tone });
    if (ms > 0) noticeTimer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);

  // ── Scans ─────────────────────────────────────────────────────────────────
  const viewRef = useRef<Screen>(view);
  viewRef.current = view;
  const scanning = useRef(false);

  const handleToken = useCallback(
    async (token: string) => {
      const current = viewRef.current;
      // No sale showing: no server call, so the customer's single-use code stays valid.
      if (current.screen !== "sale") {
        showNotice("scan.noSale", "warn");
        return;
      }
      if (scanning.current) return;
      scanning.current = true;
      showNotice("scan.checking", "info", 0);
      try {
        await displayScanCustomer(creds, current.sale.id, token);
        setNotice(null); // the state doc moves to Approving
      } catch (err) {
        const reason = errorReason(err);
        if (reason === "display_revoked") {
          setRevokedLocally(true);
          setNotice(null);
        } else {
          showNotice(SCAN_ERRORS[reason ?? ""] ?? "scan.failed", "warn");
        }
      } finally {
        scanning.current = false;
      }
    },
    [creds, showNotice]
  );

  const assembler = useRef(createHidAssembler());
  const [setupOpen, setSetupOpen] = useState(false);

  // External scanner, keyboard mode.
  useEffect(() => {
    if (!settings.scanner || settings.scannerCompat || setupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if ((e.key === "Enter" || e.key === "Tab") && assembler.current.buffer()) e.preventDefault();
      const token = assembler.current.feed(e.key, Date.now());
      if (token) void handleToken(token);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.scanner, settings.scannerCompat, setupOpen, handleToken]);

  // Compatibility mode: a hidden, focused input read on Enter.
  const compatInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!settings.scanner || !settings.scannerCompat || setupOpen) return;
    const refocus = () => compatInput.current?.focus({ preventScroll: true });
    refocus();
    const timer = window.setInterval(refocus, 1000);
    return () => window.clearInterval(timer);
  }, [settings.scanner, settings.scannerCompat, setupOpen]);

  const onCameraText = useCallback(
    (text: string) => {
      const token = assembler.current.submit(text, Date.now());
      if (token) void handleToken(token);
    },
    [handleToken]
  );

  // Dev builds only: feed the assembler key by key, as a scanner would.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __zappSimulateScan?: (text: string) => void };
    w.__zappSimulateScan = (text: string) => {
      for (const ch of text) window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    };
    return () => {
      delete w.__zappSimulateScan;
    };
  }, []);

  // ── Kiosk ─────────────────────────────────────────────────────────────────
  const [showWakeHint, setShowWakeHint] = useState(false);
  useEffect(() => {
    const lock = keepScreenOn();
    if (!lock.supported && !wakeHintSeen()) setShowWakeHint(true);
    return lock.stop;
  }, []);

  useEffect(() => {
    if (shouldReload(live.latestBuild, view.screen === "idle")) window.location.reload();
  }, [live.latestBuild, view.screen, live.nowMs]);

  const chimed = useRef<number | null>(null);
  useEffect(() => {
    if (view.screen === "flash" && view.flash.kind === "paid" && chimed.current !== view.flash.atMs) {
      chimed.current = view.flash.atMs;
      if (settings.sound) playChime();
    }
  }, [view, settings.sound]);

  // Unlinked: say so for 5 s, then forget the credentials.
  useEffect(() => {
    if (view.screen !== "unlinked") return;
    const timer = window.setTimeout(onUnlinked, 5000);
    return () => window.clearTimeout(timer);
  }, [view.screen, onUnlinked]);

  // ── Setup: 2-second press on the shop name ───────────────────────────────
  const pressTimer = useRef<number>();
  const startPress = () => {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => setSetupOpen(true), LONG_PRESS_MS);
  };
  const endPress = () => window.clearTimeout(pressTimer.current);

  const unlink = async (): Promise<boolean> => {
    try {
      await displaySignOut(creds);
    } catch (err) {
      if (errorReason(err) !== "display_revoked") return false;
    }
    onUnlinked();
    return true;
  };

  if (view.screen === "unlinked") {
    return (
      <main className="screen center">
        <h1>{t("pairing.unlinked")}</h1>
      </main>
    );
  }

  const merchantName = "merchantName" in view ? view.merchantName : "";
  const cameraActive = settings.camera && view.screen === "sale" && !setupOpen;

  return (
    <>
      <header
        className="shopbar"
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="brand" aria-hidden>
          Zapp Pay
        </span>
        <span className="shopname">{merchantName}</span>
      </header>

      <CounterScreen
        view={view}
        lang={lang}
        scannerOn={settings.scanner}
        cameraOn={cameraActive}
        camera={cameraActive ? <CameraScanner onText={onCameraText} /> : undefined}
      />

      {notice && <div className={`toast toast-${notice.tone}`}>{t(notice.key)}</div>}
      {live.reconnecting && <div className="banner">{t("reconnecting")}</div>}

      {showWakeHint && (
        <div className="hint">
          <span>{t("wake.hint")}</span>
          <button
            className="btn btn-secondary"
            onClick={() => {
              markWakeHintSeen();
              setShowWakeHint(false);
            }}
          >
            {t("ok")}
          </button>
        </div>
      )}

      {settings.scanner && settings.scannerCompat && !setupOpen && (
        <input
          ref={compatInput}
          className="offscreen"
          inputMode="none"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-hidden
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== "Tab") return;
            e.preventDefault();
            const input = e.currentTarget;
            const token = assembler.current.submit(input.value, Date.now());
            input.value = "";
            if (token) void handleToken(token);
          }}
        />
      )}

      {setupOpen && (
        <Setup
          lang={lang}
          settings={settings}
          onChange={(s) => {
            saveSettings(s);
            onSettings(s);
          }}
          onUnlink={unlink}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </>
  );
}

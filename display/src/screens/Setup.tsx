/**
 * Setup, opened by a 2-second press on the shop name. It never asks for the
 * merchant's PIN or anything that can move money.
 */
import { useEffect, useState } from "react";
import { normaliseScannedToken } from "../scanner/tokenFormat";
import { translate, type StringKey } from "../i18n";
import { canFullscreen, toggleFullscreen } from "../kiosk/fullscreen";
import { unlockAudio } from "../kiosk/chime";
import { BUILD } from "../kiosk/version";
import type { Settings } from "../storage";
import type { Lang } from "../types";

interface Props {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  onUnlink: () => Promise<boolean>;
  onClose: () => void;
}

const LANGS: { value: Lang | null; label: string }[] = [
  { value: null, label: "" },
  { value: "en", label: "English" },
  { value: "so", label: "Soomaali" },
  { value: "ar", label: "العربية" },
];

export function Setup({ lang, settings, onChange, onUnlink, onClose }: Props) {
  const t = (k: StringKey, p?: Record<string, string | number>) => translate(lang, k, p);
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<"ok" | "bad" | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinkFailed, setUnlinkFailed] = useState(false);

  // Scanner test: show exactly what the scanner types, and whether it parses.
  useEffect(() => {
    let buf = "";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (!buf) return;
        setRaw(buf);
        setResult(normaliseScannedToken(buf) ? "ok" : "bad");
        buf = "";
      } else if (e.key.length === 1) {
        buf += e.key;
        setRaw(buf);
        setResult(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (key: "scanner" | "scannerCompat" | "camera" | "sound") => {
    unlockAudio();
    onChange({ ...settings, [key]: !settings[key] });
  };

  const row = (key: "scanner" | "scannerCompat" | "camera" | "sound", label: StringKey) => (
    <button className="setup-row" onClick={() => toggle(key)}>
      <span>{t(label)}</span>
      <span className={settings[key] ? "pill pill-on" : "pill"}>{t(settings[key] ? "setup.on" : "setup.off")}</span>
    </button>
  );

  return (
    <div className="setup-backdrop" role="dialog" aria-modal="true">
      <div className="setup">
        <h2>{t("setup.title")}</h2>

        <p className="label">{t("setup.language")}</p>
        <div className="seg">
          {LANGS.map((l) => (
            <button
              key={l.value ?? "auto"}
              className={settings.lang === l.value ? "seg-on" : ""}
              onClick={() => onChange({ ...settings, lang: l.value })}
            >
              {l.value ? l.label : t("setup.langAuto")}
            </button>
          ))}
        </div>

        {row("scanner", "setup.scanner")}
        {settings.scanner && row("scannerCompat", "setup.scannerCompat")}
        {row("camera", "setup.camera")}
        {row("sound", "setup.sound")}

        <p className="label">{t("setup.test")}</p>
        <div className="scan-test">
          <p className="muted">{t("setup.testHint")}</p>
          <code dir="ltr">{raw || t("setup.testWaiting")}</code>
          {result === "ok" && <p className="ok">{t("setup.testOk")}</p>}
          {result === "bad" && <p className="warn">{t("setup.testBad")}</p>}
        </div>

        {canFullscreen() && (
          <button className="btn btn-secondary wide" onClick={() => void toggleFullscreen()}>
            {t("setup.fullscreen")}
          </button>
        )}

        {confirmUnlink ? (
          <div className="unlink-confirm">
            <p>{t("setup.unlinkConfirm")}</p>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmUnlink(false)}>
                {t("confirm.no")}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  setUnlinkFailed(false);
                  const ok = await onUnlink();
                  if (!ok) setUnlinkFailed(true);
                }}
              >
                {t("setup.unlink")}
              </button>
            </div>
            {unlinkFailed && <p className="warn">{t("setup.unlinkFailed")}</p>}
          </div>
        ) : (
          <button className="btn btn-danger-ghost wide" onClick={() => setConfirmUnlink(true)}>
            {t("setup.unlink")}
          </button>
        )}

        <button className="btn btn-primary wide" onClick={onClose}>
          {t("setup.done")}
        </button>
        <p className="muted small" dir="ltr">
          {t("setup.build", { build: BUILD })}
        </p>
      </div>
    </div>
  );
}

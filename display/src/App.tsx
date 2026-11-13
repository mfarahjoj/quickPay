import { Component, useCallback, useState, type ReactNode } from "react";
import { configError } from "./firebase";
import { Counter } from "./Counter";
import { Pairing } from "./screens/Pairing";
import { translate, isRtl, type StringKey } from "./i18n";
import { clearCreds, loadCachedIdle, loadCreds, loadSettings, saveCreds, saveLastError } from "./storage";
import type { DisplayCreds, Lang } from "./types";

export function App() {
  const [creds, setCreds] = useState<DisplayCreds | null>(loadCreds);
  const [settings, setSettings] = useState(loadSettings);
  const [notice, setNotice] = useState<StringKey | null>(null);

  const lang: Lang = settings.lang ?? loadCachedIdle()?.lang ?? "en";

  const onUnlinked = useCallback(() => {
    clearCreds();
    setNotice("pairing.unlinked");
    setCreds(null);
  }, []);

  if (configError) {
    return (
      <main className="screen center">
        <h1>{translate(lang, "notConfigured")}</h1>
        <p className="muted">{configError}</p>
      </main>
    );
  }

  if (!creds) {
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
    return (
      <Pairing
        lang={lang}
        notice={notice}
        onPaired={(c) => {
          saveCreds(c);
          setNotice(null);
          setCreds(c);
        }}
      />
    );
  }

  return <Counter key={creds.displayId} creds={creds} settings={settings} onSettings={setSettings} onUnlinked={onUnlinked} />;
}

/**
 * A crash must not leave the counter dark: report it through the next
 * heartbeat (`lastError`) and reload after 10 s.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    saveLastError(`${error.name}: ${error.message}`);
    window.setTimeout(() => window.location.reload(), 10000);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const lang = loadSettings().lang ?? loadCachedIdle()?.lang ?? "en";
    return (
      <main className="screen center">
        <p className="muted">{translate(lang, "crashed")}</p>
      </main>
    );
  }
}

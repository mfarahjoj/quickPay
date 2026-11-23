import { Component, ReactNode, useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { signOutSession, watchSession } from "./api";
import { auth } from "./firebase";
import { useI18n } from "./i18n";
import { Dashboard } from "./screens/Dashboard";
import { SignIn } from "./screens/SignIn";

/** Signed out: the QR. Signed in (a portal session): the dashboard. */
export function App() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        if (u) {
          // Only a Zapp Business session belongs here.
          const claims = (await u.getIdTokenResult()).claims;
          if (claims.portal !== true) {
            await signOut(auth);
            return;
          }
        }
        setUser(u);
      }),
    []
  );

  const ended = useCallback(() => {
    setNotice(t("signin.ended"));
    signOut(auth);
  }, [t]);

  // Leave the moment the session ends, not at the next call: what's on
  // screen should go too (a removed manager's open tab, STAFF_ACCESS.md).
  useEffect(() => {
    if (!user || !user.uid.startsWith("portal_")) return;
    return watchSession(user.uid.slice("portal_".length), ended);
  }, [user, ended]);

  const signOutHere = useCallback(async () => {
    try {
      await signOutSession();
    } catch {
      /* the session may already be over; sign out here regardless */
    }
    setNotice(null);
    await signOut(auth);
  }, []);

  if (user === undefined) return null;
  if (!user) return <SignIn notice={notice} />;
  return <Dashboard onSessionEnded={ended} onSignOut={signOutHere} />;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <main className="signin">
          <div className="card" style={{ padding: 32, textAlign: "center" }}>
            <p>Something went wrong.</p>
            <button className="primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

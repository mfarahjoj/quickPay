import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  auth,
  configError,
  readAdminClaims,
  signInWithGoogle,
  signOut,
  type AdminClaims,
} from "./firebase";
import { UserSearch } from "./components/UserSearch";
import { UserDetail } from "./components/UserDetail";
import { RoleQueue } from "./components/RoleQueue";
import { FloatDesk } from "./components/FloatDesk";
import { KycQueue } from "./components/KycQueue";
import { PayoutDesk } from "./components/PayoutDesk";
import { LedgerBanner } from "./components/LedgerBanner";

type Tab = "users" | "roles" | "kyc" | "float" | "payouts";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<AdminClaims | null>(null);
  const [booting, setBooting] = useState(true);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [selectedId, setSelectedId] = useState<string | undefined>();

  useEffect(() => {
    return auth.onAuthStateChanged(async (next) => {
      setUser(next);
      setClaims(next ? await readAdminClaims(next) : null);
      setBooting(false);
    });
  }, []);

  if (configError) {
    return (
      <div className="gate">
        <div className="card">
          <h1>Not configured</h1>
          <p>{configError}</p>
        </div>
      </div>
    );
  }

  if (booting) {
    return (
      <div className="gate">
        <div className="card">
          <p style={{ margin: 0 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="gate">
        <div className="card">
          <h1>Zapp Pay Admin</h1>
          <p>Internal console. Sign in with your work Google account.</p>
          {signInError && <div className="banner error">{signInError}</div>}
          <button
            className="primary"
            onClick={() =>
              signInWithGoogle().catch((err) =>
                setSignInError(err instanceof Error ? err.message : "Sign-in failed")
              )
            }
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  if (!claims?.admin || claims.adminRoles.length === 0) {
    return (
      <div className="gate">
        <div className="card">
          <h1>No access</h1>
          <p>
            {user.email} is signed in but has no admin role. Roles are granted with{" "}
            <code>scripts/set-admin-claim.js</code>; a newly granted role appears
            after the token refreshes.
          </p>
          <div className="row" style={{ justifyContent: "center", gap: 8 }}>
            <button
              onClick={async () => setClaims(await readAdminClaims(user, true))}
            >
              Re-check access
            </button>
            <button className="ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canReviewRoles =
    claims.adminRoles.includes("compliance") || claims.adminRoles.includes("super");
  const canRunFloatDesk =
    claims.adminRoles.includes("ops") || claims.adminRoles.includes("super");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Zapp Pay<span>Admin</span>
        </div>
        <div className="spacer" />
        <div className="who">
          {user.email} · {claims.adminRoles.join(", ")}
        </div>
        <button className="ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <nav className="tabs">
        <button
          className={tab === "users" ? "active" : ""}
          onClick={() => setTab("users")}
        >
          Customers
        </button>
        {canReviewRoles && (
          <button
            className={tab === "roles" ? "active" : ""}
            onClick={() => setTab("roles")}
          >
            Role applications
          </button>
        )}
        {canReviewRoles && (
          <button
            className={tab === "kyc" ? "active" : ""}
            onClick={() => setTab("kyc")}
          >
            KYC review
          </button>
        )}
        {canRunFloatDesk && (
          <button
            className={tab === "float" ? "active" : ""}
            onClick={() => setTab("float")}
          >
            Float desk
          </button>
        )}
        {canRunFloatDesk && (
          <button
            className={tab === "payouts" ? "active" : ""}
            onClick={() => setTab("payouts")}
          >
            Merchant payouts
          </button>
        )}
      </nav>

      <main className="main">
        <LedgerBanner />

        {tab === "users" && (
          <div className="split">
            <UserSearch selectedId={selectedId} onSelect={setSelectedId} />
            {selectedId ? (
              <UserDetail key={selectedId} userId={selectedId} />
            ) : (
              <div className="panel empty">
                Search for a customer to see their account.
              </div>
            )}
          </div>
        )}

        {tab === "roles" && canReviewRoles && <RoleQueue />}

        {tab === "kyc" && canReviewRoles && <KycQueue />}

        {tab === "float" && canRunFloatDesk && <FloatDesk adminUid={user.uid} />}

        {tab === "payouts" && canRunFloatDesk && <PayoutDesk />}
      </main>
    </div>
  );
}

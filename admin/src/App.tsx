import { useEffect, useState, type ReactNode } from "react";
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
import { LedgerDesk } from "./components/LedgerDesk";
import { Icon, type IconName } from "./components/Icon";
import { Avatar, BrandMark, EmptyState, Loading } from "./components/ui";

type Tab = "users" | "roles" | "kyc" | "float" | "payouts" | "ledger";

/** `short` is what the phone tab bar shows; the sidebar uses `label`. */
const TABS: Record<
  Tab,
  { label: string; short: string; icon: IconName; subtitle: string }
> = {
  users: {
    label: "Customers",
    short: "Customers",
    icon: "user",
    subtitle: "Look up a customer to review their account, wallet and recent activity.",
  },
  roles: {
    label: "Role applications",
    short: "Roles",
    icon: "briefcase",
    subtitle: "Merchant and agent applications waiting for a decision.",
  },
  kyc: {
    label: "KYC review",
    short: "KYC",
    icon: "idcard",
    subtitle: "Identity documents waiting for verification, oldest first.",
  },
  float: {
    label: "Float desk",
    short: "Float",
    icon: "banknote",
    subtitle: "Agent float requests and balances.",
  },
  payouts: {
    label: "Merchant payouts",
    short: "Payouts",
    icon: "send",
    subtitle: "Send each payout on its rail first, then record the reference here.",
  },
  ledger: {
    label: "Ledger",
    short: "Ledger",
    icon: "ledger",
    subtitle: "Every balance checked against the journal each night, and the tools to trace a mismatch.",
  },
};

function Gate({ children }: { children: ReactNode }) {
  return (
    <div className="gate">
      <div className="card">{children}</div>
    </div>
  );
}

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
      <Gate>
        <span className="gate-icon warn">
          <Icon name="alert" size={28} />
        </span>
        <h1>Not configured</h1>
        <p>{configError}</p>
      </Gate>
    );
  }

  if (booting) {
    return (
      <Gate>
        <Loading />
      </Gate>
    );
  }

  if (!user) {
    return (
      <Gate>
        <BrandMark size={72} />
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
      </Gate>
    );
  }

  if (!claims?.admin || claims.adminRoles.length === 0) {
    return (
      <Gate>
        <span className="gate-icon">
          <Icon name="lock" size={28} />
        </span>
        <h1>No access</h1>
        <p>
          {user.email} is signed in but has no admin role. Roles are granted with{" "}
          <code>scripts/set-admin-claim.js</code>; a newly granted role appears
          after the token refreshes.
        </p>
        <div className="row">
          <button
            onClick={async () => setClaims(await readAdminClaims(user, true))}
          >
            Re-check access
          </button>
          <button className="ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </Gate>
    );
  }

  const canReviewRoles =
    claims.adminRoles.includes("compliance") || claims.adminRoles.includes("super");
  const canRunFloatDesk =
    claims.adminRoles.includes("ops") || claims.adminRoles.includes("super");

  const visibleTabs: Tab[] = ["users"];
  if (canReviewRoles) visibleTabs.push("roles", "kyc");
  if (canRunFloatDesk) visibleTabs.push("float", "payouts", "ledger");

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside className="sidebar">
        <div className="brand">
          <BrandMark size={34} />
          <div className="brand-name">
            Zapp Pay<small>Admin</small>
          </div>
        </div>

        <nav className="nav" aria-label="Sections">
          {visibleTabs.map((id) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon name={TABS[id].icon} size={20} />
              <span className="nav-label">
                <span className="long">{TABS[id].label}</span>
                <span className="short">{TABS[id].short}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="account">
          <Avatar name={user.email ?? ""} size={32} />
          <div className="who">
            <div className="who-email" title={user.email ?? undefined}>
              {user.email}
            </div>
            <div className="who-roles">{claims.adminRoles.join(", ")}</div>
          </div>
          <button
            className="icon-btn"
            onClick={() => void signOut()}
            aria-label="Sign out"
            title="Sign out"
          >
            <Icon name="signout" size={18} />
          </button>
        </div>
      </aside>

      <main className="content" id="main" tabIndex={-1}>
        <div className="content-inner">
          <header className="page-header">
            <h1>{TABS[tab].label}</h1>
            <p>{TABS[tab].subtitle}</p>
          </header>

          <LedgerBanner
            onOpen={canRunFloatDesk && tab !== "ledger" ? () => setTab("ledger") : undefined}
          />

          <div className="view" key={tab}>
            {tab === "users" && (
              <div className="split">
                <UserSearch selectedId={selectedId} onSelect={setSelectedId} />
                {selectedId ? (
                  <UserDetail key={selectedId} userId={selectedId} />
                ) : (
                  <div className="panel">
                    <EmptyState icon="search" title="No customer selected">
                      Search for a customer to see their account.
                    </EmptyState>
                  </div>
                )}
              </div>
            )}

            {tab === "roles" && canReviewRoles && <RoleQueue />}

            {tab === "kyc" && canReviewRoles && <KycQueue />}

            {tab === "float" && canRunFloatDesk && <FloatDesk adminUid={user.uid} />}

            {tab === "payouts" && canRunFloatDesk && <PayoutDesk />}

            {tab === "ledger" && canRunFloatDesk && <LedgerDesk />}
          </div>
        </div>
      </main>
    </div>
  );
}

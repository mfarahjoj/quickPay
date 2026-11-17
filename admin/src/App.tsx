import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import {
  auth,
  configError,
  appCheckMissing,
  readAdminClaims,
  signInWithGoogle,
  signOut,
  type AdminClaims,
} from "./firebase";
import { UserSearch } from "./components/UserSearch";
import { UserDetail } from "./components/UserDetail";
import { OpenAccountContext } from "./components/AccountLink";
import { RoleQueue } from "./components/RoleQueue";
import { FloatDesk } from "./components/FloatDesk";
import { KycQueue } from "./components/KycQueue";
import { PayoutDesk } from "./components/PayoutDesk";
import { ZaadDesk } from "./components/ZaadDesk";
import { AgentZaadDesk } from "./components/AgentZaadDesk";
import { LedgerBanner } from "./components/LedgerBanner";
import { LedgerDesk } from "./components/LedgerDesk";
import { DisputeDesk } from "./components/DisputeDesk";
import { AuthMigrationPanel } from "./components/AuthMigrationPanel";
import { PricingPanel } from "./components/PricingPanel";
import { TopupDesk } from "./components/TopupDesk";
import { TodoDesk, type ShortcutLink } from "./components/TodoDesk";
import { Icon, type IconName } from "./components/Icon";
import { Avatar, BrandMark, EmptyState, Loading } from "./components/ui";
import { ledgerNeedsAttention, queuesFor, useWork, waitingTotal, type QueueKey } from "./work";

type Tab = "todo" | "users" | "topups" | "roles" | "kyc" | "float" | "payouts" | "zaad" | "agentzaad" | "disputes" | "ledger" | "pricing";

/**
 * The sidebar, in sections. "To do" comes first and the console opens on it.
 * On a phone the tab bar keeps only `phone` tabs; the queues are one tap away
 * on the To do page.
 */
const SECTIONS: { title?: string; tabs: Tab[] }[] = [
  { tabs: ["todo", "users"] },
  { title: "Queues", tabs: ["disputes", "payouts", "float", "zaad", "agentzaad", "roles", "kyc"] },
  { title: "Money", tabs: ["topups", "ledger"] },
  { title: "Settings", tabs: ["pricing"] },
];
const PHONE_TABS: Tab[] = ["todo", "users", "topups", "ledger", "pricing"];

/** `short` is what the phone tab bar shows; the sidebar uses `label`. */
const TABS: Record<
  Tab,
  { label: string; short: string; icon: IconName; subtitle: string }
> = {
  todo: {
    label: "To do",
    short: "To do",
    icon: "todo",
    subtitle: "Everything waiting on you, across every desk. Open a card to work it.",
  },
  users: {
    label: "Accounts",
    short: "Accounts",
    icon: "user",
    subtitle:
      "Everything about one customer, shop or agent in one place: what's waiting on Zapp for them, their money, and their history. Decide it all here.",
  },
  topups: {
    label: "Top up a wallet",
    short: "Top up",
    icon: "banknote",
    subtitle: "Add dollars or shillings to an account with money Zapp has received on Zaad, eDahab or the bank.",
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
  zaad: {
    label: "Zaad top-ups",
    short: "Zaad",
    icon: "inbox",
    subtitle: "Payments to the collection number that couldn't be credited, the texts behind them, and the listener phones.",
  },
  agentzaad: {
    label: "Zaad via agents",
    short: "Agents",
    icon: "send",
    subtitle: "Customers pay an online agent's Zaad and the agent's float tops them up. Decide disputes and reversals, and set up agents' receiving numbers.",
  },
  disputes: {
    label: "Disputes",
    short: "Disputes",
    icon: "flag",
    subtitle: "Claims that a payment, top-up or cash-out went wrong. Decide the ones waiting on Zapp, oldest deadline first.",
  },
  pricing: {
    label: "Pricing & rules",
    short: "Pricing",
    icon: "scale",
    subtitle: "Fees, agent commissions, referral rules, payout times and safety limits. Super admins change them; every change is audited.",
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
  const [tab, setTab] = useState<Tab>("todo");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [find, setFind] = useState("");
  const [findQuery, setFindQuery] = useState<{ text: string; nonce: number } | undefined>();
  const findRef = useRef<HTMLInputElement>(null);

  const roles = claims?.adminRoles ?? [];
  const canReviewRoles = roles.includes("compliance") || roles.includes("super");
  const canRunFloatDesk = roles.includes("ops") || roles.includes("super");
  const queueKeys = useMemo(() => queuesFor(canReviewRoles, canRunFloatDesk), [canReviewRoles, canRunFloatDesk]);
  const work = useWork(user?.uid ?? "", claims?.admin ? queueKeys : [], !!claims?.admin && canRunFloatDesk);

  // Coming back to a desk after deciding something elsewhere: fresh counts.
  const { refresh } = work;
  useEffect(() => {
    refresh(20 * 1000);
  }, [tab, refresh]);

  const waiting = waitingTotal(work);
  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting}) Zapp Pay — Admin` : "Zapp Pay — Admin";
  }, [waiting]);

  // "/" jumps to the quick find from anywhere that isn't a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        findRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = (next: string) => {
    setTab(next as Tab);
    window.scrollTo({ top: 0 });
  };

  /** From any desk: straight to that account's page. */
  const openAccount = useCallback((uid: string) => {
    setSelectedId(uid);
    setTab("users");
    window.scrollTo({ top: 0 });
  }, []);

  const quickFind = (e: React.FormEvent) => {
    e.preventDefault();
    const text = find.trim();
    if (!text) return;
    setSelectedId(undefined);
    setFindQuery({ text, nonce: Date.now() });
    setTab("users");
    setFind("");
    findRef.current?.blur();
  };

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

  const allowed = (t: Tab): boolean => {
    if (t === "roles" || t === "kyc") return canReviewRoles;
    if (t === "todo" || t === "users" || t === "pricing") return true;
    return canRunFloatDesk;
  };
  const sections = SECTIONS.map((sec) => ({ ...sec, tabs: sec.tabs.filter(allowed) })).filter(
    (sec) => sec.tabs.length > 0
  );

  /** The number on a nav item: what is waiting in that desk. */
  const countFor = (t: Tab): number | null => {
    if (t === "todo") return waiting > 0 ? waiting : null;
    if (t === "ledger") return ledgerNeedsAttention(work.ledger) ? Math.max(1, work.ledger?.openAlertCount ?? 0) : null;
    const q = work.queues[t as QueueKey];
    return q?.count ? q.count : null;
  };

  const shortcuts: ShortcutLink[] = [
    { tab: "users", label: "Find an account", hint: "Open items, money, devices and history", icon: "user" },
    ...(canRunFloatDesk
      ? ([
          { tab: "topups", label: "Top up a wallet", hint: "Credit money Zapp received", icon: "banknote" },
          { tab: "ledger", label: "Ledger", hint: "Nightly check and traces", icon: "ledger" },
        ] as ShortcutLink[])
      : []),
    { tab: "pricing", label: "Pricing & rules", hint: "Fees, limits and commissions", icon: "scale" },
  ];

  return (
    <OpenAccountContext.Provider value={openAccount}>
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

        <form className="quick-find" onSubmit={quickFind} role="search">
          <input
            ref={findRef}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find an account"
            aria-label="Find an account by phone, name, uid or receipt"
            aria-keyshortcuts="/"
          />
          <kbd aria-hidden="true">/</kbd>
        </form>

        <nav className="nav" aria-label="Sections">
          {sections.map((sec, i) => (
            <div className="nav-section" key={sec.title ?? i}>
              {sec.title && <div className="nav-heading">{sec.title}</div>}
              {sec.tabs.map((id) => {
                const count = countFor(id);
                return (
                  <button
                    key={id}
                    aria-current={tab === id ? "page" : undefined}
                    onClick={() => open(id)}
                    data-phone={PHONE_TABS.includes(id) ? "" : undefined}
                  >
                    <Icon name={TABS[id].icon} size={20} />
                    <span className="nav-label">
                      <span className="long">{TABS[id].label}</span>
                      <span className="short">{TABS[id].short}</span>
                    </span>
                    {count != null && (
                      <span
                        className={`nav-count${id === "ledger" || (id !== "todo" && work.queues[id as QueueKey]?.urgent) ? " bad" : ""}`}
                        aria-label={`${count} waiting`}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
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
          {appCheckMissing && (
            <div className="banner error" role="alert">
              <strong>This build has no App Check key, so every action will be refused.</strong>{" "}
              Set <code>VITE_APPCHECK_SITE_KEY</code> in <code>admin/.env.local</code> to the
              reCAPTCHA Enterprise key registered for this web app under Firebase console → App
              Check, then rebuild and redeploy.
            </div>
          )}
          <header className="page-header">
            <h1>{TABS[tab].label}</h1>
            <p>{TABS[tab].subtitle}</p>
          </header>

          {tab !== "todo" && (
            <LedgerBanner
              onOpen={canRunFloatDesk && tab !== "ledger" ? () => setTab("ledger") : undefined}
            />
          )}

          <div className="view" key={tab}>
            {tab === "todo" && (
              <TodoDesk
                work={work}
                keys={queueKeys}
                onOpen={open}
                shortcuts={shortcuts}
                showLedger={canRunFloatDesk}
              />
            )}

            {tab === "users" && (
              <div className="split">
                <UserSearch selectedId={selectedId} onSelect={setSelectedId} autoQuery={findQuery} />
                {selectedId ? (
                  <UserDetail
                    key={selectedId}
                    userId={selectedId}
                    adminUid={user.uid}
                    canRunFloat={canRunFloatDesk}
                    canReview={canReviewRoles}
                  />
                ) : (
                  <div className="panel">
                    <EmptyState icon="search" title="No account selected">
                      Search by phone, name, uid or receipt, or click a name on any desk.
                    </EmptyState>
                  </div>
                )}
              </div>
            )}

            {tab === "topups" && canRunFloatDesk && <TopupDesk />}

            {tab === "roles" && canReviewRoles && <RoleQueue />}

            {tab === "kyc" && canReviewRoles && <KycQueue />}

            {tab === "float" && canRunFloatDesk && <FloatDesk adminUid={user.uid} isSuper={claims.adminRoles.includes("super")} />}

            {tab === "payouts" && canRunFloatDesk && <PayoutDesk />}

            {tab === "zaad" && canRunFloatDesk && <ZaadDesk isSuper={claims.adminRoles.includes("super")} />}

            {tab === "agentzaad" && canRunFloatDesk && <AgentZaadDesk />}

            {tab === "disputes" && canRunFloatDesk && <DisputeDesk />}

            {tab === "ledger" && canRunFloatDesk && <LedgerDesk />}

            {tab === "pricing" && <PricingPanel canEdit={claims.adminRoles.includes("super")} />}
            {tab === "pricing" && canRunFloatDesk && <AuthMigrationPanel isSuper={claims.adminRoles.includes("super")} />}
          </div>
        </div>
      </main>
    </div>
    </OpenAccountContext.Provider>
  );
}

# Admin Console v1 — Plan

**Status**: Proposed — not started
**Date**: 2026-08-04
**Goal**: Make the Hargeisa pilot operable by humans without laptop scripts or hand-edited Firestore documents. Four capabilities: role approval, KYC review, float issuance, user lookup & freeze.

---

## 1. Why this is a pilot blocker

Four things are true of the platform today, and each of them is a reason a pilot cannot safely take real customer money:

- **Anyone can become an agent.** `setupPin` (`functions/src/auth/setupPin.ts:169`) writes whatever `accountType` the client sends, including `topup_agent` and `agent_merchant`. Privileged roles are granted by asking for them.
- **Nobody can approve KYC.** `submitKYC` writes `users/{uid}/kyc/latest` with `status: "submitted"` and sets `kycStatus: "submitted"`. No code path ever moves either to `verified`. Every user who submits documents is stuck, and the KYC tier limits are therefore decorative.
- **Float is sold by running a script.** `scripts/seed-agent-float.js` posts a real journal entry using the *developer's personal Firebase CLI refresh token*. There is no record of who issued float, no second pair of eyes, no receipt for the agent, and no way to do it from anywhere but this laptop.
- **A compromised account cannot be stopped.** `isActive` exists on the user doc but is enforced in exactly one place — the *recipient* check in `sendP2P.ts:94`. A frozen user can still pay merchants, cash out at an agent, and send P2P. Freezing today does almost nothing.

Below these sits a fifth problem: there is no audit trail for operator actions, because there are no operator actions — only direct database access.

## 2. Scope

**In scope for v1**

| Module | What it does |
|---|---|
| Role approval gate | Users request a privileged role; an admin grants it. No self-selection. |
| KYC queue | Review submitted documents, approve or reject with a reason, set the verified tier. |
| Float desk | Issue and withdraw agent float through the ledger, with maker-checker above a threshold. |
| User lookup & freeze | Find any user, see their real state, freeze/unfreeze, clear PIN lockout, de-register devices. |

**Explicitly not in v1** — dispute/case management, analytics dashboards, external reconciliation against bank and Stripe, treasury float rebalancing, agent performance reporting, bulk operations, manual ledger adjustments. Each is real work; none of them blocks the pilot. Manual adjustments in particular should wait until the audit and maker-checker patterns have been used in anger.

## 3. Architecture

### 3.1 Shape

A **Vite + React + TypeScript SPA** in a new top-level `admin/` directory, deployed to a **second Firebase Hosting site** (`zapp-admin`) in the same project. `firebase.json` moves from a single `hosting` object to a `hosting` array with `target` entries, and `.firebaserc` gains the target mapping.

React (not Next.js) because there is no SSR requirement, the whole surface is behind auth, and the team already writes React. A second Hosting site (not a path on the marketing site) so the admin origin is separate for CSP, headers, and the App Check key.

### 3.2 The console never touches Firestore directly

Every read and every write goes through **callable functions in `functions/src/admin/`**. Firestore rules stay exactly as closed as they are today — no admin read grants, no widened field allowlists. This matters more than it sounds: rules that grant broad admin reads become the thing an attacker targets after phishing one operator account. Callables let each action carry its own authorization check, argument validation, rate limit, and audit write.

### 3.3 Authentication and authorization

- **Google sign-in** for admins (recommended over email/password: no password to phish or reuse, and MFA is inherited from the Google account). Firebase Auth already backs the mobile apps; this is a second provider on the same project.
- Authorization by **custom claims**: `admin: true` plus `adminRole: "super" | "ops" | "compliance"`. Claims are set only by a CLI script run by a super admin — never through the console itself in v1, so privilege escalation requires shell access to the project.
- A shared `requireAdmin(request, role)` helper in `functions/src/admin/guard.ts` is the single authorization choke point, mirroring how `requireAuth` works today.
- **Re-authentication for sensitive actions** (freeze, float issuance, KYC approval): require `auth_time` within the last 10 minutes, reusing the freshness pattern already proven in `resetPin.ts`.
- App Check (reCAPTCHA Enterprise) on the admin origin, consumed on the money-moving callables.

Role split: `ops` gets lookup, freeze, float issuance requests. `compliance` gets KYC review and role approval. `super` gets everything plus float approval. One person may hold several claims during the pilot — the point is that the *actions* are separable when the team grows.

### 3.4 Audit log — non-negotiable

Every admin callable writes an immutable `admin_audit` document in the same transaction as its effect:

```ts
interface AdminAuditEntry {
  actor: string;            // admin uid
  actorEmail: string;
  action: string;           // "kyc.approve", "float.issue", "user.freeze", …
  target: { type: "user" | "role_request" | "kyc" | "float"; id: string };
  before?: Record<string, unknown>;   // changed fields only
  after?: Record<string, unknown>;
  reason: string;           // required, free text, min length enforced
  journalEntryId?: string;  // when the action moved money
  at: Timestamp;
  ip?: string;
}
```

Server-only in rules, never updated or deleted, and — like the journal — corrections are new entries. When the Bank of Somaliland asks who verified a given customer or who issued float to an agent, this is the answer.

## 4. Modules

### 4.1 Role approval gate

**Backend changes**

- `setupPin` stops honoring `accountType` from the client. Every account is created as `customer`. (The merchant app's onboarding calls this with `merchant`/`agent_merchant` — it must change to create a request instead.)
- New collection `roleRequests/{requestId}`: `{ userId, requestedRole, businessName, area, evidence?, status: "pending"|"approved"|"rejected", createdAt, reviewedBy?, reviewedAt?, reason? }`.
- New callable `requestRole` (user-facing, called by the merchant app) and `reviewRoleRequest` (admin, `compliance`). Approval sets `users.accountType`, calls the existing `ensureMerchantProfile` logic, writes the audit entry, and notifies the user.

**Migration.** Existing accounts that self-selected a privileged role must be reviewed, not grandfathered silently: a one-off script lists every non-`customer` account with its balance and transaction count, and each is approved (creating a backdated audit entry) or demoted. Pre-launch volume makes this an afternoon, and it never gets cheaper.

**Related bug to fix in the same pass:** `lookupUserByPhone` (`functions/src/users/lookupUser.ts:48`) authorizes `topup_agent` and `merchant` but **not** `agent_merchant` — the role the merchant app actually assigns to agent-merchants. Any agent-merchant trying to look up a customer for a top-up is denied today.

### 4.2 KYC queue

**Backend changes**

- Queue reads use a **collection-group query** on the `kyc` subcollection ordered by `status` + `submittedAt`, so there is no duplicated queue collection to keep in sync. Requires a collection-group index in `firestore.indexes.json`.
- ID photos live in Storage and stay unreadable by clients: `getKycSubmission` returns **short-lived signed URLs** (15 min) generated server-side. The console never gets a durable link to a customer's passport.
- `reviewKyc(uid, decision, reason, tier)` sets `users.kycStatus` to `verified` or `rejected`, stamps the `kyc/latest` doc with reviewer and timestamp, sets the KYC tier that drives limits, writes the audit entry, and notifies the user. Rejection requires a reason; the user must be able to resubmit.

**Console UI.** Queue list (oldest first, with age badges), detail view with the three photos side by side and the typed ID number, approve/reject with reason, and the user's wallet state alongside so a reviewer can see if the account has been transacting while unverified.

**Dependency worth naming:** approving KYC is only meaningful if limits are enforced per tier. `getAccountLimits` currently advertises daily aggregates that nothing enforces. Tier enforcement is not in this plan's scope, but KYC approval is half a feature without it — schedule it next.

### 4.3 Float desk

This module moves real money, so implementation follows the `new-money-flow` skill checklist rather than this section alone.

**Model.** An agent buys float: they hand over value (cash at the office, a Zaad transfer, a bank deposit) and receive e-money in their wallet. The journal entry debits the account where the value actually landed and credits the agent's wallet:

| Funding route | Debit | Credit |
|---|---|---|
| Cash to the office / agent network | `float:agents` | `user:{agent}` |
| Zaad transfer to company account | `float:zaad` | `user:{agent}` |
| eDahab transfer | `float:edahab` | `user:{agent}` |
| Bank deposit | `float:bank` | `user:{agent}` |

The admin picks the route, and it is recorded with an external reference (Zaad transaction ID, deposit slip number). `seed-agent-float.js` hardcodes `float:agents` regardless of how the money arrived, which is fine for seeding test data and wrong for real issuance — getting this right from day one is what makes external reconciliation possible later.

**Withdrawal** is the mirror entry (debit `user:{agent}`, credit the float account) for when an agent returns e-money for cash.

**Maker-checker.** `requestFloatIssuance` creates a pending `floatIssuances/{id}` doc; `approveFloatIssuance` posts the entry. Above a configurable threshold (suggest **$500**, stored in `config/rates` alongside the other tunables) the approver must be a different admin than the requester — enforced server-side by comparing uids. Below the threshold a single `ops` admin may self-approve, still fully audited.

**Idempotency.** Entry ID `float_issue_{issuanceId}` / `float_withdraw_{issuanceId}`, so a double-tapped approve button cannot double-issue.

**Console UI.** Agent float positions (wallet balance per agent, sorted by lowest), issue/withdraw form with route + external reference + reason, pending approvals queue, and issuance history. The agent gets a notification and a `transactions` row, so they have a receipt.

### 4.4 User lookup and freeze

**The enforcement gap is the real work here.** Adding a freeze button is an afternoon; making freeze *mean* something is the task.

- New field `accountStatus: "active" | "frozen" | "closed"` on the user doc, with `frozenReason`, `frozenBy`, `frozenAt`. A new explicit field rather than reusing `isActive`, which already carries "deleted" semantics from `deleteAccount.ts` and is checked inconsistently.
- New shared guard `requireActiveAccount(uid)` in `functions/src/utils/validation.ts`, called at the top of **every** value-moving callable: `sendP2P`, `processPayment`, `payMerchant`, `approvePaymentRequest`, `refundPayment`, `customerCashOut`, `agentConfirmCashOut`, `manualTopup`, `agentConfirmTopup`, `customerRequestAgentTopup`, `topupFromMobileMoney`, `cashOutToMobileMoney`, `payrollPayout`, `createRemittance`. Both sides of a two-party flow are checked — a frozen merchant should not receive either.
- Because this touches every money path, it ships with Jest coverage asserting each callable rejects a frozen actor. This is the kind of change where one missed call site is the whole vulnerability.

**Lookup view.** Search by phone, uid, or name. Shows profile and KYC status, wallet balance with ledger-derived balance beside it (a visible mismatch is a drift alarm), recent transactions, recent journal entries, PIN lockout state, trusted devices (`functions/src/auth/trustedDevice.ts`), and velocity counters.

**Support actions:** freeze/unfreeze, clear PIN lockout (`pinFailedAttempts`/`pinLockedUntil` and the agent OTP equivalents in `otpGuard.ts`), de-register a trusted device, and resend a notification. Each requires a reason and writes audit.

## 5. Build order

Sequenced so that the highest-risk holes close first and nothing waits on the UI.

| Phase | Work | Closes |
|---|---|---|
| **A. Backend foundation** | `requireAdmin` guard, custom-claims script, `admin_audit` writes, rules for new collections | — |
| **B. Freeze enforcement** | `accountStatus` + `requireActiveAccount` at every money call site + tests | Compromised accounts can't be stopped |
| **C. Role gate** | `setupPin` hardening, `roleRequests`, `reviewRoleRequest`, migration script, `lookupUserByPhone` fix | Anyone can become an agent |
| **D. Console shell** | Vite app, Google auth, second Hosting site, user lookup + freeze UI | Support has no tooling |
| **E. KYC queue** | Collection-group index, signed URLs, `reviewKyc`, queue UI | KYC submissions rot |
| **F. Float desk** | Issuance/withdrawal callables, maker-checker, float UI | Float sold by laptop script |
| **G. Retire the script** | Delete `seed-agent-float.js` or restrict it to emulator use | Personal credentials moving real money |

Phases A–C are backend-only and deliver most of the safety benefit before a single screen exists. If the pilot date compresses, they are the part that cannot be cut.

## 6. Risks

- **One missed call site in phase B** leaves freeze partially enforced, which is worse than no freeze because it will be trusted. Mitigation: enumerate call sites from `index.ts` exports, assert coverage in tests, and grep for direct `prepareJournalEntry` callers as a second check.
- **Admin account compromise** is now a path to money. Mitigation: Google MFA, custom claims settable only via shell, re-auth freshness on sensitive actions, maker-checker on float, and an audit log the attacker cannot edit.
- **Signed-URL leakage** for KYC photos — mitigated by 15-minute expiry and never storing the URL client-side.
- **Migration of existing privileged accounts** could demote a real pilot agent. Mitigation: review list first, decide per account, and notify anyone demoted.
- **Scope creep into case management.** The queue UIs will invite "just add a note field." Notes are fine; workflow state machines are v2.

## 7. Decisions needed

1. **Admin auth provider** — recommend Google sign-in with an email allowlist. Confirm which accounts get `super`.
2. **Maker-checker threshold** — recommend $500; single-admin below, two-admin above.
3. **Existing privileged accounts** — review-and-approve individually (recommended) vs. blanket grandfather.
4. **Whether `merchant` self-registration also goes behind approval**, or only agent roles. Recommend gating both: a merchant with a till is a fraud surface too, and the pilot is small enough to review each one.

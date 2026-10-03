# Security & Workflow Remediation Plan

From the architecture audit of 2026-10-03 (branch `fix/remove-minting-callables`).
Numbers (#1–#11, W1–W3, M) match the audit findings. No function that moves
money ships to prod without explicit per-deploy authorization (CLAUDE.md).

## Status

| Item | Phase | Status |
|---|---|---|
| W1 One source for prod | 0 | committed 2026-10-03, merchant API merged (`b6e3e81`), pushed 2026-10-03. Prod/source names match except `cancelCashOut`, `expireAgentRequests` (not deployed) |
| W2 CI fix | 0 | committed 2026-10-03 — runs on all branches, deploy job removed, merchant/admin typecheck added; lint non-blocking (backlog) |
| #1 Self top-up mint | 1 | hotfix committed 2026-10-03 (`utils/agentGuards.ts`, 11 tests); deployed to prod 2026-10-03 (hash bc9ab2b4, from `0ac145e`). Retirement of `manualTopup` waits on D2 |
| M Business-level monitors | 1 | committed 2026-10-03 (`ledger/activityMonitor.ts`, 17 tests, Ledger Desk section); **deploy pending authorization**: `ledgerInvariantCheck`, `adminGetLedgerOverview`, `adminGetLedgerAlert`, `adminRunLedgerCheck` + hosting:admin |
| #2 Commission round-trip | 1 | blocked on D1 |
| #3 Unauthenticated name lookup | 2 | blocked on D4 |
| #4 Lockout races | 2 | open |
| #5 Missing App Check | 2 | open |
| #6 Referral farming | 3 | blocked on D3 |
| #7 Merchant profile rename | 3 | open |
| #8 Float maker-checker structuring | 3 | open |
| #9 Refunds on P2P/payroll | 3 | open |
| #10 PIN in Keychain | 3 | open (needs design pass) |
| #11 Currency mixing | 3 | open |
| Phase 4 lows, W3 rules tests | 4 | open |

## Phase 0 — one source for prod, before any deploy

**W1.** Commit the working tree on `fix/remove-minting-callables` in logical
commits and push. Merge `feat/merchant-payments-api` in. Diff
`firebase functions:list` against `index.ts` exports and record anything live
that isn't in source. From then on: deploy only from a pushed commit, only
named functions (`--only functions:x,y`).

**W2.** CI runs on every branch push and PR (not just `main`). Remove the
`deploy-functions` job — deploys are manual and authorized. Add typecheck
jobs for `merchant-app` and `admin`.

### Phase 0 follow-ups

- **Cash-out holds in prod.** Prod's `customerCashOut` hash can't be tied to a
  commit. If it is the hold version (money moves to `platform:cashout_hold` at
  request time), unclaimed holds have no expiry path until `cancelCashOut` and
  `expireAgentRequests` deploy. Check `ledger_balances/platform:cashout_hold`
  and pending `cashOutRequests` in the console before the next deploy.
- **Revoke `FIREBASE_TOKEN`** from the GitHub repo secrets — nothing uses it
  now, and it is a standing prod-deploy credential.
- **Lint backlog**: functions ~5.7k (mostly `--fix`able), mobile 29 errors.

## Phase 1 — stop value creation (Critical)

**#1 Self top-up mint** — `functions/src/topup/manualTopup.ts`,
`agentConfirmTopup.ts`.
- Hotfix: refuse `userId === agentId`; allow only `topup_agent` /
  `agent_merchant` (drop plain `merchant`); recipient must be an active
  customer; per-transaction cap and `enforceVelocity` on the agent.
- Shared `assertDistinctParties(payer, payee)` for every agent flow.
- Then retire `manualTopup` (no customer consent) in favour of
  `agentConfirmTopup`; migrate `merchant-app/src/services/topup.service.ts`
  and `mobile/src/screens/topup/ManualTopupScreen.tsx`.
- Tests: self-topup refused, plain merchant refused, commission still paid.
- Deploy: `manualTopup` only.

**#2 Commission round-trip** — `config/rates.ts`, `agentConfirmCashOut.ts`,
`customerCashOut.ts`, both apps' cash-out screens. Needs D1.
- Split `topupCommissionRate` → `cashInCommissionRate` /
  `cashOutCommissionRate`; add customer-paid `cashOutFeeRate` (held with the
  amount, to `platform:fees` on confirm).
- Invariant: cash-out fee ≥ cash-out commission.
- No commission when the same agent↔customer cash-in happened in the last
  24h; cap commissioned tx per customer per day.
- i18n for the fee in en/so/ar, both apps.
- Tests: round trip unprofitable; fee charged; pairing rule.

**M Business-level monitors** — extend `ledger/invariantCheck.ts` (or a
sibling scheduled job): daily `platform:fees` net, commission per agent over
threshold, agent↔customer round trips, self-referencing entries →
`ledger_alerts`, surfaced on the Ledger Desk.

## Phase 2 — High

**#3 Unauthenticated phone→name oracle** — `remittance/createWebTopup.ts`,
`hosting/public/index.html`. Stripe is still a stub and `stripeWebhook`
refuses everything, so web top-up cannot complete today.
- Recommended now: disable the endpoint (503) and hide the form.
- When Stripe goes live: masked name only, App Check (reCAPTCHA Enterprise),
  per-IP/per-phone rate limit, write `webTopups` only after a real intent.

**#4 Lockout races** — `auth/validatePin.ts`, `utils/otpGuard.ts`,
`auth/resetPin.ts`. Increment-and-check inside a transaction *before*
comparing (reserve the attempt; clear on success). bcrypt stays outside the
transaction. Tests: 20 parallel wrong guesses via `Promise.all` → lockout
still holds.

**#5 Missing App Check** — add `enforceAppCheck: true` to all 21 callables,
`refundPayment`, `loginWithPin`, `setupPin`, `changePin`, `submitKYC`,
`registerMerchant` first. Add a test that fails if any exported callable lacks
it.

## Phase 3 — Medium

- **#6 Referral farming** — bonus pays only after the new user's first
  qualifying event (cash-in ≥ $5 or KYC verified); skip frozen referrers; cap
  per referrer per month; move `BONUS_CENTS` to `config/rates`. Needs D3.
- **#7 Merchant rename** — `merchantProfiles` read-only in rules; edits via a
  callable, name changes go to admin review; rules test.
- **#8 Float maker-checker structuring** — threshold on rolling 24h total per
  requester+agent, not per request; same for payouts.
- **#9 Refunds on P2P/payroll** — `refundPayment` only for merchant-payment
  entries (`qrpay_`, `custqr_`, `pay_` prefixes or an explicit flag); refund
  window from config.
- **#10 PIN in Keychain** — stop storing the PIN; biometric unlock releases a
  device-bound key and the server verifies a signature
  (`react-native-biometrics` keypair). Own design pass; both apps; simulator
  verification.
- **#11 Currency mixing** — reject currency ≠ wallet currency in `sendP2P`
  and centrally in `prepareJournalEntry`.

## Phase 4 — Low

- `revokeRefreshTokens(uid)` in `resetPin` and `revokeTrustedDevices`.
- Post-reset shop allowance counted inside the payment transaction.
- Cash-out code griefing: count failures per agent per request.
- `getEncryptionKey`: fail unless the key is 64 hex characters.
- Receipts path `receipts/{uid}/{txId}`, owner-only.
- **W3** Rules tests with `@firebase/rules-unit-testing` on the emulator —
  deny case per collection, the `users` update allowlist — in CI.

## Execution order

| Step | Contents | Deploy target (each needs authorization) |
|---|---|---|
| 1 | W1, W2 | none |
| 2 | #1 hotfix + M | `manualTopup`, `ledgerInvariantCheck` |
| 3 | #4, #5 | auth callables + `refundPayment` |
| 4 | #3 | `createWebTopup` + hosting |
| 5 | #2 (after D1) | cash-in/out callables + both app builds |
| 6 | #6–#9, #11, Phase 4 | by file group |
| 7 | #10 | full app release of both apps |

## Open decisions

- **D1** Cash-out pricing and agent commission split.
- **D2** Retire `manualTopup` entirely, or keep it admin-only?
- **D3** Referral unlock: first cash-in or KYC?
- **D4** Web top-up: disable now, or mask and keep?
- **D5** Canonical main branch: `main` or `feat/merchant-receive-hardening`?

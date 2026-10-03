# Zapp Pay (repo: QuickPay)

Somaliland-focused mobile-money platform. **Zapp Pay** is the consumer brand; QuickPay is the internal/repo name. Currency is USD, amounts are **integer cents** everywhere.

- `mobile/` — React Native **customer** app (QR pay, top-up, remittance)
- `merchant-app/` — React Native **merchant/agent** app (accept payments, agent top-ups)
- `functions/` — Firebase Cloud Functions v2 (TypeScript) backend
- `hosting/` — static pages (privacy, support)

Account types: `customer`, `merchant`, `topup_agent`, `agent_merchant`. Prod Firebase project: `quickpay-485417`.

## Money invariants (apply to every change that touches value)

1. **Every value movement posts a double-entry journal entry** through `functions/src/ledger/` (`prepareJournalEntry` → `prepared.write(tx)`, inside the same Firestore transaction as the rest of the flow). Never mutate `wallets.{uid}.balance` directly — wallet docs are cached projections, not the source of truth. See `LEDGER_ARCHITECTURE.md` for the chart of accounts and per-flow entry templates.
2. **Zero-sum, immutable, idempotent.** Entry doc ID = deterministic idempotency key (e.g. `p2p_{transactionId}`). Corrections are new `adjustment`/`refund` entries — never edits or deletes.
3. **Agent flows debit/credit agent float in the same transaction.** Agents pre-purchase float; no code path may create unbacked value (two colluding accounts once could — that bug is why this rule exists).
4. **Rates are config, not code.** Fees/commissions read from Firestore `config/rates` (defaults in `functions/src/config/rates.ts`). Never hardcode a rate.
5. **Guards run before posting:** App Check on callables, PIN verification for user-initiated debits, KYC per-transaction caps, and `enforceVelocity` (`functions/src/utils/velocity.ts`).
6. **Every `transactions` writer sets the `participants` array** and links `journalEntryId`.
7. Money helpers: `dollarsToCents`/`centsToDollars` in `functions/src/utils/validation.ts`.

Use the `new-money-flow` skill when adding or modifying any flow that moves value.

## Deployment discipline

- **Never deploy functions that alter money movement to prod without explicit per-target authorization from the user.**
- Deploy only from a pushed commit, and only named targets (`firebase deploy --only functions:a,b`). A bare `--only functions` from a checkout missing another branch's functions deletes or rolls them back. CI never deploys.
- App changes: build and verify on the **iOS simulator first**. Only archive/upload to TestFlight when the user explicitly asks — then use the `release-testflight` skill (it encodes the stale-archive verification steps).
- Zaad/eDahab services (`functions/src/integrations/`) are **sandbox stubs** that fake success — do not assume real rails are connected.

## i18n

Every user-facing string ships in **all three locales** — `en`, `so`, `ar` — in both apps (`mobile/src/i18n/locales/`, `merchant-app/src/i18n/locales/`). `fallbackLng='en'` silently hides missing keys; do not rely on it.

## Design

- `DESIGN_SYSTEM.md` — base palette and components.
- Merchant app: dark-glass Revolut style, blue accent `#1A56FF`, incoming green `#34C77B` (reference: `merchant-app/src/screens/dashboard/DashboardScreen.tsx`).
- Customer onboarding: "dark kinetic" theme — ink `#0D0B0A`, coral `#FF5043`, teal `#5DCAA5`.

## Verification

- Functions: `cd functions && npm test` (Jest; v2 callables wrap as `wrapped({data, auth})`).
- Both apps must pass `tsc` clean before any build.
- Firestore: new queries need composite indexes in `firestore.indexes.json`; ledger collections (`journal_entries`, `ledger_balances`) stay **server-only** in `firestore.rules`.

## Doc map

| Doc | Contents |
|---|---|
| `LEDGER_ARCHITECTURE.md` | Chart of accounts, journal entry schema, per-flow templates, reconciliation |
| `docs/MERCHANT_API.md` | Merchant Payments API (`functions/src/api/`): keys, charges, refunds, webhooks, hosted checkout |
| `DESIGN_SYSTEM.md` | Colors, typography, component patterns |
| `GTM_ROADMAP.md` | Hargeisa launch phases, KPIs, risks |
| `SECURITY_REMEDIATION_PLAN.md` | Audit findings (2026-10-03), fix plan per finding, status, open decisions |
| `CASH_IN_CASH_OUT.md` | Agent cash-in/cash-out: flow steps, ledger entries, guards, threat model |
| `MANUAL_TOPUP_GUIDE.md` | Agent top-up operational flow |
| `TESTFLIGHT_QUICKSTART.md` | One-time Apple/signing setup |

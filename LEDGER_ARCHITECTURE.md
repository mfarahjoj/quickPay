# Zapp Ledger Architecture

**Status**: Approved design — migration in progress
**Date**: 2026-07-19
**Goal**: One ledger core that works unlicensed today (Zaad/eDahab settlement, agent cash-in/out) and becomes a fully custodial wallet the day a license lands — with zero data-model changes.

---

## 1. Why we're doing this

Today every money movement mutates `wallets.{uid}.balance` directly inside a Firestore
transaction and writes a row to `transactions`. That works, but:

- Balances are free-floating mutable numbers. If a bug, a partial write, or a bad deploy
  corrupts one, there is no way to prove what it *should* be.
- `transactions` is a display log, not an accounting record — nothing enforces that money
  out equals money in.
- There is no representation of where real money sits (Zaad float held by agents, the
  bank account behind Stripe payouts), so reconciliation against the outside world is
  impossible.
- Regulators license ledgers, not apps. When the Somaliland licensing conversation
  happens, "we can show every cent from genesis" is the difference between a pilot
  approval and a rejection.

## 2. How the successful ones do it

Patterns taken from the operators we studied:

**M-Pesa (Safaricom, Kenya)** — the canonical African model. Customer money is *not* on
Safaricom's balance sheet: cash collected in exchange for e-float sits in **trust
accounts at commercial banks**, while the M-Pesa platform is purely a ledger of
entitlements to that float. A P2P transfer moves e-money between two users; the trust
account is untouched. Agents hold **float** (e-money working capital) and rebalance
cash↔float at super-agents; only rebalancing touches the trust account. The core insight:
**the ledger and the custody are separate layers** — which is exactly what lets Zapp
build the ledger now and attach custody later.

**Alipay / WeChat Pay (China)** — grew as internal-ledger wallets; the PBOC later forced
**100% of customer funds into central-bank reserve accounts** and all transactions
through a central clearing house. Lesson: regulators eventually demand full reserve
backing and auditable settlement records. Build the ledger so that "show me that customer
liabilities are fully backed by segregated funds" is a query, not a forensic project.

**Wave (Senegal — first non-telco EMI licensed in WAEMU)** — a technology-led operator
whose engineering centers on **high-frequency ledger performance and agent liquidity
logistics**. Their merchant product bundles "simple ledger, float and reconciliation
tools." Lesson: agent float management *is* the product in cash-heavy markets; the ledger
must model agent float as a first-class account.

**Modern fintech ledger engineering** (Stripe/Adyen-style patterns, Modern Treasury,
TigerBeetle): append-only immutable journal; every entry is a set of postings that
**sum to zero per currency**; **idempotency keys** with a uniqueness constraint so
retries can never double-post; balances are a **derived read-model**, not the source of
truth; a scheduled invariant check replays the journal and alarms on drift.

Sources: [NBER — The Economics of M-PESA](https://www.nber.org/system/files/working_papers/w16721/w16721.pdf), [IFC/World Bank M-PESA case study](https://documents1.worldbank.org/curated/en/832831500443778267/pdf/117403-WP-KE-Tool-6-7-Case-Study-M-PESA-Kenya-Series-IFC-mobile-money-toolkit-PUBLIC.pdf), [Cato — PBOC mobile payment regulation](https://www.cato.org/cato-journal/winter-2019/analysis-pbocs-new-mobile-payment-regulation), [IBA — Alipay e-payment regulation](https://www.ibanet.org/article/5D63B47D-B8C6-47E9-92ED-D32EEDEB00F8), [Wave EMI license](https://www.wave.com/en/blog/sn-emi/), [Wave engineering](https://wave.engineering/about/), [Fintechly — ledger system design](https://fintechly.com/infrastructure/infrastructure-ledger-system-design/), [SDK.finance — double-entry ledger](https://sdk.finance/blog/what-is-a-double-entry-ledger-in-fintech/), [Finlego — real-time double-entry ledger](https://finlego.com/blog/designing-a-real-time-ledger-system-with-double-entry-logic).

## 3. Design

### 3.1 Chart of accounts

Account IDs are strings with a `kind:identifier` shape. Accounts are implicit (no
registry document needed to post to one) but typed.

| Account | Kind | Normal side | Meaning |
|---|---|---|---|
| `user:{uid}` | liability | credit | A customer/merchant/agent wallet. What Zapp owes them. |
| `platform:fees` | income | credit | Platform revenue (payment fees, net of agent commissions). |
| `platform:promo` | expense | debit | Referral/signup bonuses funded by the platform. |
| `float:agents` | asset | debit | Real cash/Zaad value held by the agent network backing wallet liabilities. |
| `float:bank` | asset | debit | Money in the bank account (Stripe payouts land here). |
| `float:zaad`, `float:edahab` | asset | debit | Value held in the company's own Zaad/eDahab accounts. |
| `external:clearing` | clearing | — | Pass-through leg for no-custody settlements (QR→USSD dial): records that value moved on Telesom's rail without touching Zapp float. |

**The accounting equation is the reconciliation**: at all times,
`sum(float:*) = sum(user:*) + platform:fees − platform:promo`. When someone (or a
regulator) asks "is customer money fully backed?", that is one query.

This mirrors M-Pesa exactly: `user:*` balances are e-float entitlements; `float:*` is
the trust-account layer. Today `float:*` tracks agent cash and the bank account; after
licensing it points at a segregated trust account — **no schema change**.

### 3.2 Journal entries (source of truth)

New collection `journal_entries`, append-only, one document per business event:

```ts
interface JournalEntry {
  /** Doc ID = idempotency key (deterministic per business event). */
  type: "p2p" | "qr_payment" | "customer_qr_payment" | "refund"
      | "agent_topup" | "agent_cashout" | "stripe_topup" | "remittance"
      | "referral_bonus" | "payroll" | "opening_balance" | "adjustment";
  currency: "USD" | "SLS";
  /** Zero-sum: sum(debits) === sum(credits). Enforced at post time. */
  lines: Array<{
    account: string;        // e.g. "user:abc123", "platform:fees"
    debit: number;          // cents; exactly one of debit/credit is > 0
    credit: number;         // cents
  }>;
  /** Business references — link back to app objects. */
  refs: { transactionId?: string; qrCodeId?: string; topupId?: string;
          remittanceId?: string; refundOfEntryId?: string };
  description: string;
  postedBy: string;         // uid or "system"
  postedAt: Timestamp;
}
```

Rules enforced by the single choke-point `postJournalEntry()`:

1. **Zero-sum** — debits equal credits, per currency, or the post throws. Money cannot
   be created or destroyed by any code path, only moved.
2. **Immutable** — entries are created, never updated or deleted. Corrections are new
   `adjustment`/`refund` entries referencing the original.
3. **Idempotent** — the entry doc ID *is* the idempotency key (e.g.
   `p2p_{transactionId}`). Posting uses `create()` semantics inside the transaction: a
   retry of the same event fails the create and returns the already-posted entry instead
   of double-moving money.
4. **Atomic with the projection** — the same Firestore transaction that creates the
   entry updates the cached balances (§3.3). Either both happen or neither.
5. **No negative liabilities** — a debit to `user:{uid}` that would take the cached
   balance below zero aborts (overdrafts don't exist). `float:*` and `platform:*`
   accounts are exempt (platform may run a promo deficit intentionally).

### 3.3 Balances (derived read-model)

`wallets/{uid}` keeps exactly its current shape (`balance`, `totalSent`,
`totalReceived`, …) so **no client changes are required** — but it is demoted from
source of truth to *cached projection*, only ever written by `postJournalEntry()` in the
same transaction as the journal write. Non-user accounts (`platform:*`, `float:*`,
`external:clearing`) get projection docs in a new `ledger_balances` collection so hot
accounts keep using `FieldValue.increment` (no read-contention).

### 3.4 Rail adapters — how money enters, moves, and leaves

Every product flow is a journal entry template. The rails differ; the ledger doesn't.
Agent cash-in and cash-out, with guards and threat model: `CASH_IN_CASH_OUT.md`.

| Flow | Debit | Credit |
|---|---|---|
| Agent cash-in (customer hands agent cash, `agentConfirmTopup`) | `user:{agent}` (their float e-money) | `user:{customer}` |
| Agent commission | `platform:fees` | `user:{agent}` |
| Stripe/diaspora top-up (`stripeWebhook`) | `float:bank` | `user:{customer}` |
| P2P (`sendP2P`) / payroll | `user:{sender}` | `user:{recipient}` |
| QR payment against balance (`processPayment`, `payMerchant`, `approvePayment`) | `user:{customer}` | `user:{merchant}` (net) + `platform:fees` (fee) |
| Refund | `user:{merchant}` (net) + `platform:fees` (fee) | `user:{customer}` |
| Cash-out hold (`customerCashOut`, entry `cashouthold_{id}`) | `user:{customer}` | `platform:cashout_hold` |
| Cash-out settle (`agentConfirmCashOut`, entry `cashout_{id}`) | `platform:cashout_hold` | `user:{agent}` |
| Cash-out release: cancel, expiry, 5 wrong codes, replaced (`cashoutrelease_{id}`) | `platform:cashout_hold` | `user:{customer}` |
| Referral bonus (`setupPin`) | `platform:promo` | `user:{customer}` |
| **No-custody QR→USSD dial** (V1 merchant QR) | `external:clearing` | `external:clearing` |
| **[Post-license] wallet top-up from trust account** | `float:trust` | `user:{customer}` |

The no-custody row is the key adaptability trick: a QR payment settled by a Zaad USSD
dial posts a zero-net pass-through entry (both legs on `external:clearing`) purely for
history/receipts/analytics — no wallet is touched because Zapp never held the money.
When licensed, the *same* QR flow switches template to the balance-settled row. The apps,
receipts, and history render from the same journal either way.

### 3.5 Reconciliation & integrity (the part regulators ask about)

- **Invariant job** (scheduled, daily at first): replay `journal_entries`, recompute
  every account balance, compare against cached projections and against the accounting
  equation. Any drift → alert + freeze flag. This is the "balances are derived"
  discipline from §2 applied to Firestore.
- **Spend-index probe** (same job, plus live on every `adminGetLedgerHealth`): run the
  spend-limit aggregation and record `spendIndexOk` on the checkpoint. Drift is about
  money already misrecorded; this is about money that cannot move at all. The limits
  check in front of every outbound flow fails closed — correctly, since a cap that
  opens up during an outage is not a cap — so a composite index that stops covering
  its query takes down cash-out, QR payment, P2P, remittance and payroll at once.
  A missing `amount` field did exactly that, and a customer noticed first.
- **External reconciliation**: `float:bank` vs actual bank/Stripe balance;
  `float:agents` vs agent float attestations. Mismatches become explicit `adjustment`
  entries with an audit trail — never silent edits.
- Firestore security rules: `journal_entries` and `ledger_balances` are
  **server-only** (no client read/write); clients keep reading `wallets/{own uid}` and
  `transactions` exactly as today.

## 4. Migration plan

Pre-launch traffic is low, so we cut over directly — no shadow-write phase.

1. **Ledger core** — `functions/src/ledger/`: types, `postJournalEntry()` (zero-sum +
   idempotency + projection update + overdraft guard), account helpers, entry templates
   per flow. *(this change)*
2. **Opening balances** — one-time script: for every existing wallet with a nonzero
   balance, post an `opening_balance` entry (`float:agents` → `user:{uid}`) so the
   journal explains 100% of every balance from day one. *(this change)*
3. **Migrate flows** — refactor each money-moving function to call
   `postJournalEntry()` instead of mutating balances; external behavior (request/response
   shapes, `transactions` rows, notifications) unchanged. Order: `sendP2P` (reference)
   → QR payments → refund → top-ups/cash-outs → remittance/Stripe → payroll →
   referral bonus. *(this change, at least through the QR family)*
4. **Invariant job + rules** — scheduled reconciliation function; lock down the new
   collections in `firestore.rules`.
5. **Later, when licensed** — add `float:trust`, point top-up/cash-out templates at it,
   turn on custodial settlement for QR. No migration needed — that's the point.

## 5. What deliberately does NOT change

- Client apps: read the same `wallets` and `transactions` docs.
- PIN, velocity, KYC-limit, App Check checks: unchanged, still run before posting.
- `transactions` collection: still written (it's the user-facing history); each row now
  carries `journalEntryId` linking display to accounting truth.
- The Zaad/eDahab service stubs: remain the future home of real API integrations; the
  USSD dial-through remains the only live Zaad rail until Telesom grants API access.

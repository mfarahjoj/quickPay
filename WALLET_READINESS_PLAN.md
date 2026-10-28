# Wallet readiness: Zapp Pay + Zapp Pay Merchant

**Date:** 2026-10-17
**Question:** Do the customer app, the merchant app and the backend work together as one wallet? Covers customers topping up, paying and resolving disputes, and merchants charging, topping up, settling and resolving disputes.
**Short answer:** The money core is solid: a double-entry ledger, idempotent entries, holds for cash-out and payouts, PIN, velocity and KYC guards. The gaps are around it:
- Two pricing exploits are still open.
- **Disputes don't exist as a feature.** There is no claim, queue or correction tool anywhere.
- Refunds are one-way and all-or-nothing.
- Ops can't fix a wrong balance without writing code.

This plan closes those gaps in five phases.

Related: `SECURITY_REMEDIATION_PLAN.md` (items #2–#11, decisions D1–D5), `BACKLOG.md`, `CASH_IN_CASH_OUT.md`, `LEDGER_ARCHITECTURE.md`.

---

## 1. How money moves today

| Journey | Who | Function(s) | Ledger entry | State |
|---|---|---|---|---|
| Top up with cash at an agent | customer → agent | `customerRequestAgentTopup` → `agentConfirmTopup` | `agenttopup_{id}`: agent float → customer, plus commission `platform:fees` → agent | ✅ Works |
| Agent tops up by phone number | agent | `manualTopup` | agent → customer | ⚠️ Legacy, retirement waits on D2 |
| Top up from Zaad / eDahab / card | customer | `topupFromMobileMoney`, `createWebTopup` + `stripeWebhook` | — | ⛔ Removed: the integrations are stubs. `createWebTopup` is still public (#3) |
| Pay a shop's sticker (static QR) | customer | `payMerchant` | `paymerchant_*` with fee | ✅ Idempotent |
| Pay a shop's on-screen QR (dynamic) | customer | `processPayment` | `qrpay_{qrId}` with fee | ✅ QR single-use |
| Shop scans the customer's QR and charges | merchant → customer approves | `scanCustomerToken` → `createPaymentRequest` → `approvePaymentRequest` | `custqr_{requestId}` with fee | ✅ 90 s expiry, cancel |
| Pay online / at a POS | customer | Merchant API `/v1` → `approveApiCharge` | with online fee | ✅ Partial refunds via API |
| Send to a person | customer | `sendP2P` | `p2p_*`, **no fee** | ⚠️ See F3 |
| Payroll | merchant | `payrollPayout` | `payroll_*` | ✅ |
| Refund an in-store payment | merchant | `refundPayment` | `refund_{txId}`, exact reversal | ⚠️ Full only, merchant only |
| Cash out at an agent | customer → agent | `customerCashOut` → `agentConfirmCashOut` | hold → agent, plus commission | ✅ Hold design is good |
| Merchant settlement (get paid) | merchant → ops | `requestPayout` → `adminSettlePayout` / `adminRejectPayout` | hold → `float:{route}` | ✅ But manual and depends on the console |
| Agent float purchase / return | ops | `adminRequestFloat` / `adminApproveFloat` | `float:{route}` → agent | ✅ Console only, no in-app request |
| Fix a wrong balance | ops | — | `adjustment` type exists in `ledger/types.ts` | ⛔ Nothing posts one |
| Dispute a payment, top-up or cash-out | anyone | — | — | ⛔ Does not exist |

---

## 2. Findings

Severity:
- **S1**: loses money, or blocks a real wallet launch.
- **S2**: users get stuck, or support can't resolve something.
- **S3**: makes the two apps or the operation less cohesive.

### A. Money safety

**F1 (S1) Commission round-trip, security item #2.** Both cash-in and cash-out pay the agent `topupCommissionRate` (2%) out of `platform:fees` (`topup/agentConfirmCashOut.ts:188`, `topup/agentConfirmTopup.ts`). The customer pays no cash-out fee. A colluding agent and customer can loop the same $100 in and out and earn 4% per lap from Zapp. This is blocked on **D1** (cash-out pricing).

**F2 (S1) Referral farming, item #6.** `auth/setupPin.ts` pays the bonus at sign-up. New SIMs turn into free money that can be cashed out at an agent. This is blocked on **D3**.

**F3 (S1) Merchants can take payments as P2P and skip the fee.** `wallet/sendP2P.ts` never checks the recipient's `accountType`, so a customer can "send" to a shop's number and the 1% fee is gone. The resulting transaction is also typed `payment` (line 140), so it looks like a sale.

**F4 (S1) Merchant rename, item #7.** Merchant names can be changed freely. A shop can rename itself to look like another shop that customers already trust, and the customer's confirm screen shows that name.

**F5 (S2) Currency mixing, item #11.** `validateCurrency` accepts `USD` and `SLS`. `prepareJournalEntry` doesn't compare the entry currency with the wallet currency (`ledger/post.ts`). An "SLS" payment debits the same integer from a USD wallet: 10,000 SLS cents (about $1) takes $100. No value is created, but a customer can lose money through a mislabelled amount.

**F6 (S2) Refunds aren't limited to merchant payments, item #9.** P2P and payroll rows are typed `payment` too, so `refundPayment` lets any P2P recipient or employee "refund". There's also no refund time window.

**F7 (S2) Float structuring, item #8.** The maker-checker threshold applies to each request, not to a rolling total, so large float can be split into small requests. The same applies to payouts.

**F8 (S2) Public web top-up endpoint, item #3 and D4.** `createWebTopup` is unauthenticated and reveals the account name behind a phone number.

### B. Disputes and support (largest gap)

**F9 (S1) No dispute system.** There's no `disputes` collection, callable, admin queue or status anywhere in `functions/`, `admin/`, or either app.
- The merchant app's **Report a problem** (`merchant-app/src/screens/transactions/TransactionDetailScreen.tsx:113`) shows an alert saying "Contact support and quote transaction {id}", with no link.
- The customer receipt (`mobile/src/screens/wallet/TransactionDetailScreen.tsx`) has no help action at all.
- Support is only an email address on `support.html`.

**F10 (S1) Ops can't correct a balance.** `ledgerDesk.ts` says drift "is fixed by posting an `adjustment` journal entry", but no callable or script posts one. That leaves no way to resolve a dispute that goes against the merchant, a wrong top-up, or a cash-out where the agent never handed over the cash, except a hand-written prod script.

**F11 (S2) Refunds are one-way and all-or-nothing.**
- Only the merchant can start a refund. The customer can't ask for one in the app.
- In-store refunds are full only. The API supports partial refunds, the counter doesn't.
- If the merchant has already requested a payout, the refund fails with "Insufficient balance" and there's no fallback.
- The customer receipt never shows that a payment was refunded. The mobile app never reads `refundedAt` or `refundOfTransactionId`.

**F12 (S2) Agent disputes have no record.**
- *Cash-in:* the customer hands over cash and the agent never confirms. The request expires, and nothing records that cash changed hands.
- *Cash-out:* the agent confirms but doesn't hand over the cash. The customer has nothing to show except the transaction ID.
- Neither side can raise a claim, and agents have no rating or complaint count.

**F13 (S2) A stolen phone can't be frozen by its owner.** There's no self-freeze and no in-app emergency contact. `adminSetAccountStatus` exists, but only ops can use it, and only after an email.

**F14 (S2) Push notifications are English only.** `utils/notifications.ts` sends fixed English titles and bodies ("Refund Received", payment received, top-up completed) to Somali and Arabic users.

### C. Merchant side

**F15 (S2) Agent-merchants can't request float in the app.** Float is only issued from the admin Float Desk. For `agent_merchant` accounts, float and shop takings are the same wallet balance, so the merchant can't see how much is float and how much is sales. A sales payout can also eat the float needed for top-ups.

**F16 (S2) Settlement is manual, with no visible timeline.** `requestPayout` holds the money and ops send the transfer by hand. The merchant is notified when a payout is settled or rejected (`admin/payoutDesk.ts:197,305`), but sees no expected time and has no scheduled or automatic payout option. All of this depends on the admin console being deployed with App Check working (BACKLOG "Not for a loop").

**F17 (S3) Merchant error messages still show raw server text** on the top-up, refund, scan and login screens (BACKLOG #8). A wrong PIN on refund fails the whole flow instead of returning to the keypad.

### D. How well the two apps fit together

**F18 (S3) The customer app still has merchant and agent screens.** `MerchantOnboarding`, `MerchantQR`, `MerchantScan`, `EnterAmount` and `ManualTopup` are registered in `mobile/src/navigation/AppNavigator.tsx`. `ProfileScreen` shows a merchant QR for `merchant` accounts, and `agent_merchant` accounts get a "customer" badge. Two apps that do the same job confuse users and double the work of testing both.

**F19 (S3) One transaction type covers too many things.** `payment` is used for shop payments, P2P and payroll. That is the root cause of F3 and F6, makes receipts show the wrong label, and makes reporting by kind impossible.

**F20 (S3) Dead code ships in the customer app.** It contains `SendRemittanceScreen`, which calls `createRemittance` and `completeRemittance` (both deleted from prod), and `MobileMoneyScreen`. Neither screen is registered as a route, but both are still in the bundle.

### E. Operations

**F21 (S2)** No external reconciliation and no alert that reaches a person (BACKLOG #1). No callable error-rate alert (#6). No backup or restore runbook (#7). No staging project for money-path changes.

**F22 (S2)** No happy-path test for refunds (BACKLOG #4). The sandbox-stub guard tests are still open (#3b). `consumeAppCheckToken` replay protection isn't on (#2).

**F23 (S2)** PIN login is broken until the functions' service account gets *Service Account Token Creator* (BACKLOG). The PIN is stored on the device instead of being released from the Keychain (#10).

---

## 3. Plan

Each phase ends with a deploy that Mahamed authorises per target, as `CLAUDE.md` requires. Anything that moves value follows the `new-money-flow` skill: every value movement posts a journal entry, and every row sets `participants` and `journalEntryId`.

### Phase 1: Close the money leaks (launch-gating)
*Goal: no path loses Zapp or a customer money.*

| # | Work | Fixes | Needs |
|---|---|---|---|
| 1.1 | Split rates into `cashInCommissionRate` and `cashOutCommissionRate`, and add a customer-paid `cashOutFeeRate` that is held with the amount and goes to `platform:fees` on confirm. Show the fee on the cash-out screen in en/so/ar. | F1 | **D1** |
| 1.2 | Pay the referral bonus only after the new user's first qualifying event. Skip frozen referrers, cap bonuses per referrer per month, and move `BONUS_CENTS` to `config/rates`. | F2 | **D3** |
| 1.3 | Make `sendP2P` refuse merchant and agent-merchant recipients with an error like "This is a shop, pay it by QR". Also add a `kind` field (see 3.1). | F3 | — |
| 1.4 | Make `merchantProfiles` read-only in rules. Name changes go through a callable into admin review. Add a rules test. | F4 | — |
| 1.5 | Reject any entry whose currency differs from a user wallet's currency inside `prepareJournalEntry`, plus a guard in `sendP2P`. Until SLS has its own wallets, accept USD only. | F5 | — |
| 1.6 | Allow `refundPayment` only on merchant-payment entries (`qrpay_`, `custqr_`, `paymerchant_`), within `refundWindowDays` from config. | F6 | — |
| 1.7 | Apply the maker-checker threshold to the rolling 24-hour total per requester and agent, for float and for payouts. | F7 | — |
| 1.8 | Disable `createWebTopup` (return 503) and hide the form. | F8 | **D4** |
| 1.9 | Add tests: the refund happy path plus a double-refund test, and stub guard tests that fail if a sandbox success can credit a wallet. | F22 | — |

### Phase 2: Corrections and disputes
*Goal: every "something went wrong" has a path, a record and an owner.*

**Status 2026-10-18:** 2.1–2.5 deployed to prod (backend) on 2026-10-18 from `8add088`; the app and console screens ship with the next builds. 2.6 (agent standing, `listAgents`) and 2.7 (`freezeMyAccount`, support links) deployed 2026-10-18 from `824c2c8`. The SMS "lock my account" link isn't possible: Firebase Auth sends the sign-in SMS, so there is no way to add a link to it.

**2.1 Adjustment desk (fixes F10, and is the base for everything else in this phase)**
- Add `adminPostAdjustment(account, counterAccount, amount, reason, disputeId?)`. It posts a balanced `adjustment` journal entry. The default counter account is `platform:fees` or `platform:promo`, never a hidden balance edit.
- Maker-checker above a threshold, recorded in `admin_audit`, and the affected user is notified.
- Add an "Adjust" action in the console's `UserDetail` and `LedgerDesk`.

**2.2 Dispute model (F9, F12)**
- New collection `disputes/{id}` with these fields: `transactionId`, `raisedBy`, `against`, `kind`, `status`, `messages[]`, `evidence[]`, `resolution`, `adjustmentEntryId?`, `refundTransactionId?`, `slaDueAt`.
- `kind` is one of `not_received`, `wrong_amount`, `unauthorised`, `refund_not_given`, `cash_not_given`, `cash_given_not_credited` or `other`.
- Status moves `open` → `merchant_responding` → `under_review` → `resolved_customer`, `resolved_merchant` or `withdrawn`.
- New callables: `openDispute`, `respondToDispute`, `withdrawDispute`, and `adminResolveDispute`, which may refund, adjust or reject.
- Rules: only participants read a dispute, and only functions write it.
- Limits: one open dispute per transaction, a filing window (say 60 days), and a rate limit per user.
- For `cash_given_not_credited`, `customerRequestAgentTopup` keeps the expired request and agent id, so the claim points at a real request.

**2.3 Customer app**
- Add a **Get help with this payment** action on every receipt. It opens a dispute with a reason picker and a short note.
- Add a dispute list with live status.
- Receipts show **Refunded** and link to the refund (fixes F11).

**2.4 Merchant app**
- Replace the **Report a problem** alert with a real dispute form.
- Add a **Disputes** inbox with a badge, plus **Accept & refund** and **Reply** actions.
- Disputes from customers show here with a response deadline.

**2.5 Admin console**
- Add a **Disputes desk** with a queue sorted by SLA, the transaction trace (reuse `adminTraceLedgerAccount`), both parties' history, and resolve actions that call 2.1 or `refundPayment` as ops.

**2.6 Agent accountability**
- Count disputes per agent, and auto-flag an agent once they pass N upheld claims in 30 days.
- Show agents in the AgentLocator only while they are in good standing.

**2.7 Lock a lost phone (F13)**
- Add a **Freeze my account** button in Security. It sets `frozen` and is reversible only through support or KYC.
- Add a lock link in the sign-in SMS that works without the phone.
- Show the support WhatsApp number and email in both apps' settings.

### Phase 3: Refunds and settlement done properly
*Goal: merchants control their money and customers can see what happened.*

**Status 2026-10-18:** 3.1 (transaction kinds), 3.2 (refund requests, built as a dispute claim) and 3.3 (partial refunds) deployed to prod 2026-10-18 from `824c2c8`; their app screens need customer build 63+ and merchant build 14+. 3.4 is covered by the D8 reserve: a refund the merchant can't cover becomes a dispute, and an upheld one reserves the amount until they can pay. 3.6 (payout time, automatic daily payouts, CSV statements) committed, not deployed. 3.5 (agent float in its own `agent:{uid}` account, Move to float, migration) committed, not deployed; see `AGENT_FLOAT_SEPARATION.md` for the deploy steps.

**3.1 Transaction kinds (F19)**
- Add `kind` to every `transactions` writer: `merchant_payment`, `p2p`, `payroll`, `topup`, `cashout`, `payout`, `refund`, `adjustment`, `referral`.
- Backfill from the `journalEntryId` prefix.
- Both apps label receipts by `kind`.

**3.2 Refund requests**
- New callable `requestRefund`, which the customer sends from a receipt. It appears in the merchant's inbox, and approving it calls `refundPayment`. This is lighter than a dispute and is tried first.

**3.3 Partial in-store refunds**
- `refundPayment` takes an `amount ≤ remaining` and tracks `refundedCents` on the original, the same way as API charges.

**3.4 Refunds after a payout**
- If the merchant's wallet is short, the refund can come from the merchant's held payout, or ops cover it from `platform:fees` and post a receivable adjustment against the merchant.

**3.5 Float shown separately for agent-merchants (F15)**
- Show **Sales** and **Float** separately, derived from the ledger: float issued minus float used.
- Payouts can only take the sales part.
- Add an in-app **Request float** button that creates an `adminRequestFloat` draft for ops.

**3.6 Settlement**
- Show the expected payout time, and offer an optional daily automatic payout above a threshold.
- Add a payout statement (CSV or PDF) per period. When real Zaad API access lands, payouts can be automated.

### Phase 4: Make the two apps one product
- **4.1 (F18)** Remove the merchant and agent screens from the customer app. The customer app is for customers only; merchants and agents use Zapp Pay Merchant. Add an "Are you a business? Get Zapp Pay Merchant" link instead.
- **4.2 (F20)** Delete the remittance and mobile-money screens and their services from the bundle.
- **4.3 (F14)** Localise push notifications: store `preferredLanguage` and send templates in en/so/ar from `utils/notifications.ts`.
- **4.4 (F17)** Finish the merchant error localisation (BACKLOG #8).
- **4.5** Make one shared receipt vocabulary in both apps: the same status names, kinds, refund and dispute badges, and transaction ID format.

**Status 2026-10-28:** 4.3 committed on `feat/push-i18n` (from `fix/customer-login`), not deployed. Every push, and the copy kept for the customer app's notifications list, is written in the recipient's `users/{uid}.preferredLanguage` (the field both language pickers save), falling back to English as the apps do. The texts are templates in en/so/ar in `functions/src/utils/pushTemplates.ts`; dates are in Hargeisa time. Each function keeps sending English until it is redeployed. These 33 send pushes:

`firebase deploy --only functions:sendP2P,functions:payrollPayout,functions:processPayment,functions:payMerchant,functions:refundPayment,functions:approvePaymentRequest,functions:createPaymentRequest,functions:rejectPaymentRequest,functions:approveApiCharge,functions:api,functions:stripeWebhook,functions:manualTopup,functions:agentConfirmTopup,functions:agentConfirmCashOut,functions:cancelCashOut,functions:expireAgentRequests,functions:changePin,functions:resetPin,functions:registerTrustedDevice,functions:completePhoneChange,functions:freezeMyAccount,functions:openDispute,functions:postDisputeMessage,functions:withdrawDispute,functions:adminResolveDispute,functions:disputeHousekeeping,functions:adminPostAdjustment,functions:adminApproveFloat,functions:adminSettlePayout,functions:adminRejectPayout,functions:adminReviewKyc,functions:adminReviewRoleRequest,functions:runAutoPayouts`

No money logic changed, but most of these move money, so each still needs the user's per-target OK, and the deploy must come from a branch that has everything prod runs, or it rolls those functions back. `feat/zaad-topups` merges cleanly in this respect: its `adminAssignMobileMoney` and `mobileMoneyListener` call `notifyTopupCompleted`, which kept its signature, so they send localized pushes once both are in.

### Phase 5: Run it safely
- **5.1 (F21)** External reconciliation and alerts that reach a person (BACKLOG #1), an error-rate alert on the money callables (BACKLOG #6), a Firestore PITR plus backup runbook (BACKLOG #7), and a staging project.
- **5.2 (F22)** Turn on `consumeAppCheckToken` for the money and admin callables.
- **5.3 (F23)** Grant the token-creator role (console). Keep the PIN in the Keychain, released by biometrics (item #10).
- **5.4** Two-device end-to-end script covering every row of the table in §1, plus a dispute for each kind, run on the staging project before each release.

---

## 4. Decisions needed from Mahamed

| | Decision | Blocks |
|---|---|---|
| D1 | **Decided 2026-10-18:** cash-out free by default, priced in the console (`cashOutFeeRate`); split commissions with a round-trip guard. Done in 1.1 | 1.1 |
| D3 | **Decided 2026-10-18:** set in the console (`referralUnlock`, bonus, minimum cash-in, monthly cap). Done in 1.2 | 1.2 |
| D4 | **Decided 2026-10-17: disable now.** Done in 1.8, deployed 2026-10-18 | 1.8 |
| D2 | Retire `manualTopup`, or keep it admin-only | cleanup |
| D6 | **Decided 2026-10-18:** refund window 30 days, dispute filing window 60 days (both in `config/rates`) | 1.6, 2.2 |
| D7 | **Decided 2026-10-18:** other party replies within 3 days or the dispute goes to ops; ops resolve within 7 days of opening | 2.2 |
| D8 | **Decided 2026-10-18: wait for funds.** An upheld dispute the other party can't cover is settled when their balance allows; until then that amount is reserved in their wallet | 2.2, 3.4 |
| D9 *(new)* | Remove merchant features from the customer app (recommended) | 4.1 |
| D10 | **Decided 2026-10-18:** separate `agent:{uid}` float account as recommended in `AGENT_FLOAT_SEPARATION.md`. Built in 3.5 | 3.5 |
| D11 | **Decided 2026-10-18: yes.** Payout time shown to merchants (`payoutTargetHours`, console); opt-in automatic daily payouts above a kept balance (`autoPayoutMinCents`); monthly CSV statements. Done in 3.6 | 3.6 |

## 5. Suggested order

1. **Phase 1.3–1.9** right away. None of these need a decision.
2. **Get D1, D3 and D6–D8 answered**, then do 1.1 and 1.2.
3. **Phase 2** before more than a pilot cohort. A wallet without disputes or corrections can't be supported.
4. **Phases 3 and 4** can run alongside each other.
5. **Phase 5.1–5.2** before you scale up.

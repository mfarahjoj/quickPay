# Merchant insights (Zapp Business)

Live data on a merchant's store, or stores, with every number leading to something
to do. Built for the web first (`portal/`), on a read model that the merchant app can
use too.

| Phase | What | Status |
|---|---|---|
| 0 | Read model: rollups per shop, nightly catch-up and check, backfill | **Live** in prod since 2026-11-18 (backfilled) |
| 1 | `portal/` web app, sign-in by scanning a QR with the merchant app, one-shop dashboard with insight cards | **Live** at zapp-business.web.app since 2026-11-18. The merchant app screen ships with the next build |
| 2 | Phone alerts: `merchantInsightAlerts` (hourly at :20) pushes the urgent cards (quiet till, display offline, refund spike), once per shop, type and day | **Live** 2026-11-18 |
| 3 | Linked stores (`functions/src/portal/groups.ts`, `storeLinks/{store}`): invite by Zapp number; the store accepts from its own Zapp Business session; the owner gets All stores, a comparison and per-store cards | **Live** 2026-11-18 |

## Principles

- **No money flow changes.** The read model is a projection of `transactions`, kept by a
  trigger that hangs off the flows the way `counterDisplay/triggers.ts` does. It holds no
  value and no money flow reads it. The ledger stays the source of truth.
- **Per currency, always.** Dollars (cents) and shillings (whole shillings) are kept apart
  in every total and never added (SHILLINGS.md).
- **Hargeisa time.** Days and hours are `Africa/Mogadishu` local time (`merchantStats/time.ts`).
- **Exactly once.** The live trigger, the nightly catch-up and the backfill all go through
  `applyStoreEvent`, which writes a marker per row in the same transaction.
- **Names, not contact details.** The privacy policy promises counterparties see a name and
  never contact details; nothing here stores a phone number.

## Data model (`merchantStats/{storeUid}`)

| Doc | Holds |
|---|---|
| `merchantStats/{store}` | First and last activity, last activity day (Hargeisa), last sale |
| `…/days/{YYYY-MM-DD}` | Per currency: sales and refunds (count, gross, fee, net), sales by hour (24 slots), sales by channel, agent cash-in/out and commission. Plus distinct customers: unique, new, returning |
| `…/months/{YYYY-MM}` | Same shape, for long ranges (12 reads for a year) |
| `…/customers/{customerUid}` | First and last seen, visits, visit days, spend and refunds per currency, usual gap between visit days (smoothed) |
| `…/live/recent` | Last 20 sales and refunds, newest first. No names: a staff manager without "Show customers" reads it (`STAFF_ACCESS.md`) |
| `…/live/recentNames` | The feed's short names ("Amina H.") by txId, for items still in the feed. Readable only by viewers who may see customers (`canViewCustomers`) |
| `…/applied/{txId}` | Idempotency marker. Kept for good: an expired marker would let a backfill count a row twice. Server-only |
| `…/days/{d}/visitors/{customer}`, `…/months/{m}/visitors/{customer}` | First-visit markers, so unique customers are exact in any event order. Server-only |
| `merchantStatsRuns/{day}` | Each night's run: rows scanned, rows caught up, shops checked, drift found. Server-only |
| `config/merchantStats` | `backfill: {active, cursorMs, scanned, applied, startedAtMs, finishedAtMs}`. Server-only |

### What counts (`merchantStats/classify.ts`)

A completed row concerns at most one shop:

| Row | Shop | Event |
|---|---|---|
| `type: payment`, kind `merchant_payment` / `online_payment` | `toUserId` | sale (customer = `fromUserId`) |
| `type: refund` | `fromUserId` | refund (customer = `toUserId`) |
| kind `cash_in` (`type: topup`) | `fromUserId` (the agent) | agent cash-in, with commission |
| kind `cash_out` (`type: withdrawal`) | `toUserId` (the agent) | agent cash-out, with commission |

Everything else (P2P, payroll, payouts, card and mobile-money top-ups, float, adjustments)
is not shop activity. A row's time is `completedAt`, falling back to `createdAt`.

### Channels

Read off the journal entry id each flow chose (`utils/transactionKind.ts`):

| Channel | Entry | Meaning |
|---|---|---|
| `sale_qr` | `qrpay_` | Sale QR for an amount, on the phone or the counter display |
| `sticker` | `paymerchant_` | The printed My QR; the customer types the amount |
| `scan` | `custqr_` | The cashier's phone scanned the customer's code |
| `display_scan` | `custqr_` + request `source: "counter_display"` | The counter tablet scanned it |
| `online` | `apicharge_` | Merchant Payments API (checkout, tills, partner apps) |

## Keeping it right

- **Live:** `merchantStatsOnTransaction` (`onDocumentWritten("transactions/{id}")`) acts when
  a row *becomes* completed. Agent cash-outs are written pending and completed later. A failure
  is logged, not retried.
- **Nightly, 03:30 Hargeisa** (`merchantStatsNightly`, after `ledgerInvariantCheck`):
  1. Catch-up: every row completed yesterday goes through `applyStoreEvent`, and rows the
     trigger missed are counted.
  2. Backfill slice, if switched on.
  3. Check: yesterday's day doc for every shop is rebuilt from the rows alone and compared.
     A difference is logged (`MERCHANT STATS DRIFT`) and stored in `merchantStatsRuns/{day}`.
     It is never patched over, so day, month and customer docs stay consistent with each other.

  One known source of drift: a sale that reaches the read model *after* a later sale by the
  same customer (only across midnight or in a backfill) counts that customer as "new" on the
  later day. The check flags it.

## Backfill

1. Deploy `merchantStatsOnTransaction` and `merchantStatsNightly` (and the rules).
2. `node scripts/backfill-merchant-stats.js --start`
3. Run the job now instead of waiting for 03:30, and repeat until `--status` says finished:
   `gcloud scheduler jobs run firebase-schedule-merchantStatsNightly-us-central1 --location=us-central1 --project=quickpay-485417`

Each run walks about 6 minutes of history, oldest first, through `applyStoreEvent`. It is
safe while shops trade, because the markers stop double counting.

## Access

`firestore.rules`: the shop itself, or a live Zapp Business session for that shop, may
read its root, `days`, `months`, `customers` and `live` docs. Markers, runs, config,
`portalLogins` and `portalSessions` are server-only. Phase 3 adds a linked group owner.

## Web sign-in (`functions/src/portal/`)

```
browser  startPortalLogin     → loginId, code (in the QR), pollSecret (kept by the page)
phone    describePortalLogin  → "Chrome on macOS": the shop checks it's their computer
phone    approvePortalLogin   → PIN (or decline); creates portalSessions/{ps_…}
browser  pollPortalLogin      → custom token for uid portal_{sid}, claims {portal, portalFor, portalSid}
```

- **A separate, read-only identity.** The browser never signs in as the shop. Its user,
  `portal_{sid}`, matches no real uid, so every `isOwner()` rule already refuses it.
  `requireAuth` and `requireAdmin` refuse any token with `portal: true`, so it reaches no
  app or console callable. A test sweeps every `onCall` for a guard (`portal.test.ts`).
  It reaches only what calls `requirePortalViewer` (`portal/viewer.ts`) and the rules'
  `isPortalFor`, and both also check that `portalSessions/{sid}` is active and unexpired.
- **The QR approves; only the page collects.** The code in the QR is what the phone sends;
  the token goes only to whoever holds the poll secret, which never leaves the page. A
  photo of the QR is useless.
- **Sessions:** `portalSessionHours` (config, default 12), at most 5 per shop (the oldest
  is signed out). Listed and signed out in the app (Settings → Zapp Business on a
  computer), or from the page. All end on a PIN change or reset, a device revoke, a
  freeze or a deletion (`endSessions` → `endAllPortalSessions`). Ending one marks it
  inactive (refused at once) and deletes its Firebase user (no more refresh). The browser
  keeps it in `sessionStorage`, so closing the tab signs a shared computer out.
- **Threat model.**
  - *QR-login phishing:* an attacker relays a real QR to the shop and gets it approved.
    The phone names the browser and says to approve only a computer in front of you. At
    worst the attacker gets read-only figures until the session ends or is signed out.
  - *Stolen session:* read-only, ends within 12 hours, and can be signed out from the phone.
  - *Guessing:* login ids and codes are 96 and 128 random bits; `startPortalLogin` is
    rate-limited per IP and polling per login.
- **Privacy:** names only, never phone numbers, in every portal reply. Receipts in
  Storage are closed to portal sessions.

## The dashboard (`portal/`)

Vite + React, App Check (reCAPTCHA Enterprise), English, Somali and Arabic (right to left),
light and dark. It reads the day docs (180 days), `live/recent` and the customer count
with listeners, and calls `portalGetStore`, `portalGetCustomers`, `portalGetCustomer`,
`portalListTransactions` and `portalExportStatement` for the rest.

- **Needs your attention** (`portal/src/lib/insights.ts`, pure, tested). Each card gives a
  severity (icon and word), the evidence, and one action: a checklist, a jump to the
  right view, or where to do it in the app. A card only speaks once there's history to
  back it (3 weeks for "typical day" cards):
  - till quiet in usually busy hours
  - counter display offline while trading
  - refund spike against the usual
  - today ahead of or behind a typical same weekday, by this hour
  - regulars gone quiet, with what they're worth a month
  - money waiting with auto payout off
  - peak hours and the quietest open hour
- **Figures.** Net takings (gross and fees), sales, average sale, distinct customers (an
  exact count), returning share, refunds, and agent commission for agents. Each is
  compared like for like: today against last week's same weekday up to this hour; a
  period against the one before, with its matching day cut at the same hour.
- **Charts** (dataviz method: validated palette, one axis, a table view for every chart):
  - today by the hour against a typical weekday, or day by day against the period before
  - weekday × hour heatmap (the last 4 weeks when "Today" is picked)
  - how customers pay
  - new and returning customers
- **Lists:** live feed; customers (top, gone quiet, new this week, recent), each with
  their history; transactions with the monthly CSV.

## Running it locally

```
firebase emulators:start --only auth,firestore,functions --project demo-zapp
cd portal && npm run dev -- --mode emulator          # http://127.0.0.1:5176
```

Seed a shop by writing `transactions` rows into the emulator: the trigger builds the
read model as in production. Sign in by approving the page's login (its id is on the QR
box as `data-login`) with `approvePortalLogin`, or by writing the session as it does.

## Deploying Zapp Business

Done 2026-11-18 in this order: 95 `requireAuth` callables, then the Firestore rules, indexes and portal functions, then `startPortalLogin`/`pollPortalLogin`, then hosting. Storage rules followed later the same day, with main's owner-only profile pictures (no app reads others' profile pictures).


1. **Done 2026-11-18.** Firebase web app "Zapp Business" (`1:76440907220:web:6a12018730432a1483fa41`),
   registered for App Check with reCAPTCHA Enterprise key `6LfLliYuAAAAAFVjf-W7EwhsLw_Xm9Dr2G2wWyrI`
   (SCORE, zapp-business.web.app and .firebaseapp.com only, min score 0.5, as the admin
   and display keys). It shares the project's browser API key with them. `PORTAL_WEB_APP_ID`
   is set in `functions/.env.quickpay-485417`. `portal/.env.local` (not committed) holds
   the config: copy `.env.example` and fill it from `firebase apps:sdkconfig WEB <app id>`.
2. **Done 2026-11-18.** Hosting site `zapp-business` (https://zapp-business.web.app), the
   `portal` target.
3. **Order matters.** A portal token gets past the old `requireAuth` (it only checked
   for a signed-in user), so no portal token may exist while any callable from before
   this change is live. A portal uid owns nothing, but an old `setupPin` could still be
   asked to open an account for it. So:
   1. First redeploy every **deployed callable that calls `requireAuth`** (or a helper that
      does: `requireAgent`, `requireShop`). On 2026-11-18 that was 95 functions. Admin-only
      callables (`requireAdmin`: an admin claim a portal token never has), counter display,
      triggers, schedules and HTTP functions don't need it. This is a deploy of money
      functions whose money logic is what main already has. It needs the owner's go-ahead.
      Check the deployed source first: on 2026-11-18 every deployed function's source was
      main or older, except `adminGetKycSubmission` and `adminGetRoleApplication`. Those
      run uncommitted work from `~/quickPay-ux` (inline KYC photos) and are admin-only, so
      they are left alone.
   2. Then deploy the rules and indexes, and the portal functions by name:
      `describePortalLogin,approvePortalLogin,listPortalSessions,revokePortalSession,
      expirePortalSessions,portalGetStore,portalGetCustomers,portalGetCustomer,
      portalListTransactions,portalExportStatement`.
   3. Last, the two that let a browser in: `startPortalLogin,pollPortalLogin`.
4. `cd portal && npm run build`, then `firebase deploy --only hosting:portal`.
5. The merchant app's Settings → Zapp Business on a computer ships with the next build.

## Cost

A sale costs about 8 reads and 8 writes, in one transaction: the marker, shop, day, month,
customer, two visitor markers and the live feed. One day doc per shop takes one write per
sale, far below Firestore's per-document limit. Dashboards read rollups only: a 30-day view
is 30 small docs per shop, and a year is 12.

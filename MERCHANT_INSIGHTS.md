# Merchant insights (Zapp Business)

Live data on a merchant's store, or stores, with every number leading to something
to do. Built for the web first (`portal/`, planned), on a read model that the merchant
app can use too.

| Phase | What | Status |
|---|---|---|
| 0 | Read model: rollups per shop, nightly catch-up and check, backfill | **Built** (this branch) |
| 1 | `portal/` web app, sign-in by scanning a QR with the merchant app, one-shop dashboard | Planned |
| 2 | Insights engine: rules over the rollups, each card with one action | Planned |
| 3 | Linked stores: an owner links several merchant accounts into a group (read-only view) | Planned |

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
| `…/live/recent` | Last 20 sales and refunds, newest first, with a short name ("Amina H.") |
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

`firestore.rules`: the shop itself may read its root, `days`, `months`, `customers` and
`live` docs. Markers, runs and config are server-only. Phase 1 adds a portal session (a
separate, read-only Firebase identity) and Phase 3 adds a linked group owner.

## Cost

A sale costs about 8 reads and 8 writes, in one transaction: the marker, shop, day, month,
customer, two visitor markers and the live feed. One day doc per shop takes one write per
sale, far below Firestore's per-document limit. Dashboards read rollups only: a 30-day view
is 30 small docs per shop, and a year is 12.

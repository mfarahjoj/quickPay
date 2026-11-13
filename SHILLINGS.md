# Shillings

Every Zapp wallet holds two balances: **dollars** and **Somaliland shillings**.
Shillings are the main currency; dollars stay for everyone who has them. The two
never convert into each other: Zapp exchanges nothing. A payment comes out of the
balance in its own currency, or it is refused.

Branch: `feat/shilling-wallets`. **Not deployed.**

## Units

Every amount is an integer in its currency's smallest unit:

| Currency | Ledger code | API code | Unit | Example |
|---|---|---|---|---|
| Dollars | `USD` | `USD` | cents | `1250` = $12.50 |
| Shillings | `SLS` | `SLSH` | whole shillings | `30000` = 30,000 SLSH |

`functions/src/utils/money.ts` maps between the codes (`currencyFromApiCode`,
`parseCurrency`) and formats amounts (`formatAmount`, `pushAmount`).
`mobile/src/utils/money.ts` is the app's side.

## Ledger

One journal entry, one currency. Each account keeps a separate balance per
currency. Dollar balances keep the projections they always had, so nothing
written before shillings moved:

| | Dollars | Shillings |
|---|---|---|
| `user:{uid}` | `wallets/{uid}.balance` | `wallets/{uid}.sls.balance` (and `sls.totalSent`, `sls.totalReceived`) |
| any other account | `ledger_balances/{account}` | `ledger_balances/{account}@SLS` |

`ledger/currency.ts` has `balanceKey` / `parseBalanceKey`. `prepareJournalEntry`
reads and writes the right pocket, so the overdraft and frozen-account rules hold
per currency: a wallet with $100 and no shillings can't pay 1 shilling. An entry
in any other currency is refused (`LedgerValidationError`).

The nightly invariant check replays the journal per currency, checks each
currency nets to zero, and compares shilling pockets and `@SLS` balance docs
the same way it compares dollars.

## Limits

Every limit stays in dollars (`config/limits`, `config/rates`). A shilling amount
counts at **`slsPerUsd`** (`config/rates`, default 8,000, editable in the console
under *Shillings*), rounded up to the cent. It is used for limits only; nobody is
ever paid at it.

- Per-transaction, daily and monthly limits: `enforceTransactionLimits(..., currency)`.
- Spend so far: `sumSpendSince` sums everything, takes the shilling rows back out
  and adds them converted. Two aggregations; the second needs the new
  `transactions (fromUserId, currency, type, createdAt, amount)` index.
- The post-PIN-reset allowance and the activity monitor's thresholds convert too.
- Zaad top-up minimum and maximum: compared converted; shown to the customer in
  shillings, rounded to 500.

## What works in shillings

| Flow | Shillings |
|---|---|
| Ledger, wallets, invariant check, activity monitor | Yes |
| Zaad top-ups (`*220*` dial code, SMS `SLSH`), held payments, admin assign and refund | Yes, to the wallet. **Not to an agent's float** (held for an admin) |
| P2P (`sendP2P`, `currency: "SLS"`) | Yes |
| Merchant API: charges (`currency: "SLSH"`), approval, refunds, webhooks, hosted checkout | Yes |
| `getBalance` (`slsBalance`), `getTransactions` (whole shillings) | Yes |
| Account deletion | Refused while shillings remain |
| Customer app: Home, charge approval, history, Zaad top-up | Yes |
| Shop QR (`generateQRCode`, `processPayment`, `payMerchant`), customer-QR requests, payroll, remittance | **Dollars only** (`validateCurrency` refuses SLS) |
| Agent cash-in, cash-out and float | **Dollars only** |
| Merchant payouts to Zaad | **Dollars only** |
| Merchant app, admin console balances | **Dollars only on screen** (the money is right; it isn't shown) |

## Before shillings are useful to Ridy drivers

Drivers paid in shillings need to turn them into cash. Next, in order:

1. Agent shilling float, cash-in and cash-out (`agent:{uid}@SLS`).
2. Payouts in shillings to the Zaad account on file.
3. Merchant app and console showing shilling balances.
4. The Zaad SMS parsers (`mobileMoney/parsers.ts`) are still empty for both
   currencies: every top-up waits for an admin until real samples are in.

## Deploy

Nothing here is deployed. With per-target approval, from a pushed commit:

1. `firebase deploy --only firestore:indexes` and wait for the new
   `transactions` index to build. **Before any function**: `sumSpendSince` fails
   closed without it, which stops every outbound payment.
2. The functions this branch changes, by name.
3. Hosting (`checkout.html`).
4. Customer app build.

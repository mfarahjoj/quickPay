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

Everything a customer, shop or agent can do in dollars they can do in
shillings, each balance on its own and never converted. The two exceptions
are rails that only exist in dollars (end of the table).

| Flow | Shillings |
|---|---|
| Ledger, wallets, invariant check, activity monitor | Yes |
| Zaad top-ups (`*220*` dial code, SMS `SLSH`), held payments, admin assign and refund | Yes: to a customer's wallet, or to an agent's shilling float (`agent:{uid}@SLS`) |
| P2P (`sendP2P`, `currency: "SLS"`), payment links (`currency=SLSH`) | Yes. A link without a currency is dollars, as before |
| Merchant API: charges (`currency: "SLSH"`), approval, refunds, webhooks, hosted checkout | Yes |
| Partner transfers (`POST /v1/transfers`, `currency: "SLSH"`) | Yes |
| `getBalance` (`slsBalance`), `getTransactions` (whole shillings) | Yes |
| Account deletion | Refused while shillings, or reserved shillings, remain |
| Agent cash-in and cash-out (`customerRequestAgentTopup`, `customerCashOut`), top up by phone (`manualTopup`), cash-out at the counter | Yes, from and to the agent's shilling float. See below |
| Agents buying float by Zaad, Move to float, the float desk | Yes. See below |
| Shop till QR, sticker QR (`payMerchant`), charges to a scanned customer code, refunds, counter display | Yes. See below |
| Payroll (`payrollPayout`, `currency: "SLS"`) | Yes: a run is in one currency, paid from that balance |
| Merchant payouts to Zaad, automatic daily payouts, statements | Yes. Automatic shilling payouts are their own opt-in. See below |
| Disputes, including the wait-for-funds reserve (D8) | Yes: a remedy is paid in the disputed movement's currency; a shilling claim the other party can't cover is reserved in their shilling pocket (`wallets.sls.reservedCents`) and collected when shillings arrive |
| Admin console | Corrections (`adminPostAdjustment` with `currency: "SLS"`), float desk, payout desk, user, dispute, KYC and ledger screens all show and take shillings |
| Customer app | Everything above, with a Shillings / Dollars choice wherever an amount is typed |
| Merchant app | Everything above, with a Shillings / Dollars switch wherever an amount is typed |
| **Card top-ups (Stripe remittance)** | **Dollars only**: Stripe can't charge in Somaliland shillings |
| **Mobile-money top-up stubs** (`topup/mobileMoneyTopup.ts`) | **Dollars only**: sandbox code, switched off in production |

### Agent cash-in and cash-out

A request is in one currency from start to finish (`topup/agentCurrency.ts`).
The customer picks dollars or shillings; the agent's float in that currency
pays a cash-in and receives a cash-out; the customer's balance in that
currency is credited or held. Commission is paid in the same currency, rounded
to a whole shilling, to the agent's own wallet. The $1 minimum, the $1,000
cash-in maximum, KYC caps and the referral minimum compare a shilling amount at
`slsPerUsd`.

**Older Zapp Pay Merchant builds read every amount as cents**, and the agent
hands over cash from what the app shows. So the merchant app sends
`currencies: ["USD", "SLS"]` with every preview and confirm, and the server
refuses a shilling request to an app that doesn't (`reason:
"update_for_shillings"`). A shilling cash-out stays held until a current app
confirms it, the customer cancels, or it expires. A cash-in confirm must also
send `expectedCurrency`, which has to match the request.

### Agents adding shilling float themselves

Besides the float desk, an agent adds float in the merchant app's two
screens, each with a Shillings / Dollars picker. Neither converts.

- **Buy float by Zaad:** `getTopupInstructions` with `currency: "SLS"` gives
  the `*220*` code. A shilling payment from the agent's linked number posts
  `float:zaad@SLS → agent:{uid}@SLS` (`floatEntry`), under the agents' float
  limit counted at `slsPerUsd`. An admin assigning a held shilling payment to
  an agent posts shilling float the same way. The activation payment stays
  in dollars.
- **Move to float:** `moveToFloat` with `currency: "SLS"` moves
  `user:{uid}@SLS → agent:{uid}@SLS` (wallet `sls.balance` into shilling
  float). The $100,000 cap counts shillings at `slsPerUsd`. A call with no
  currency moves dollars, as older merchant builds expect.

Older merchant builds never send `currency`, so they keep buying and moving
dollars. Shilling float an agent already holds doesn't show on their
screens, but nothing they do with it can go wrong: they can't spend it.

### Shops taking payment in shillings

The merchant app's Receive and Charge have a Shillings / Dollars switch. A
shilling sale is whole shillings from start to finish: the customer pays from
their shilling balance, the shop is credited the net in shillings, and the fee
(`paymentFeeRate`, rounded to a whole shilling) goes to `platform:fees@SLS`.
Limits and the allowance after a PIN reset count it at `slsPerUsd`.

- **Older customer apps read every amount as cents** and would show 30,000
  shillings as "$300.00". So `validateQRCode` and `processPayment` hand a
  shilling code only to an app that sends `currencies: ["USD", "SLS"]`;
  anything else is told to update (`updateFor: "shillings"`, `reason:
  "update_for_shillings"`) and the code stays active. Charges to a scanned
  customer code are approved on the charge screen, which has shown shillings
  since customer build 75.
- **The QR payload** carries no amount for a shilling sale. Somaliland
  shillings have no ISO 4217 code, and 706 (the Somali shilling, a different
  currency) with an amount would be misread by any other wallet. Zapp reads
  the amount from the `qrCodes` doc, as it always has.
- **Refunds** are in the payment's currency. `refundPayment` returns `amount`
  in whole units and the `currency`.
- **The counter display** shows each amount in its own currency; its state
  doc and flashes carry `currency`.
- **The sticker QR** (`payMerchant`): the customer picks Shillings or Dollars
  on the amount screen. Older customer apps only ever send dollars.
- **Cash-out at the counter**: the agent picks the currency; the customer
  pays amount and fee from that balance, the agent's float in it takes the
  amount, and the commission is in it too.

### Payouts in shillings

The merchant app's Withdraw has a Shillings / Dollars switch.
`requestPayout` with `currency: "SLS"` holds the shop's shillings in
`platform:settlement_hold@SLS`. Ops settles it to `float:zaad@SLS` once the
Zaad transfer is sent, or declines it back to the shilling balance; nothing
converts. The $5 floor, the $1,000,000 cap and the senior-approval
threshold count shillings at `slsPerUsd`. An app that sends no currency
withdraws dollars, as older builds expect.

Automatic daily payouts pay shillings only when the shop turns
"Shillings too" on (`autoPayout.shillings: { enabled, keep }`), so a shop
that set up dollar payouts before shillings is never sent shillings it
didn't ask for. Each currency is its own payout, with its own balance to
keep; the minimum counts shillings at `slsPerUsd`.

The CSV statement names each row's currency and gives each currency its own
totals line. It used to add every amount into dollars, so shilling movements
read as cents. `getStatement` returns `totals` (dollars, as older apps show)
and `totalsSls`.

## Before shillings are useful to Ridy drivers

Drivers paid in shillings need to turn them into cash. Next, in order:

1. ~~Agent shilling float, cash-in and cash-out~~: built (above).
2. ~~Agents buying shilling float themselves: by Zaad, and Move to float~~:
   built (below).
3. ~~Payouts in shillings to the Zaad account on file~~: built (below).
4. The rest of the merchant app and console showing shilling balances.
5. The Zaad SMS parsers (`mobileMoney/parsers.ts`) are still empty for both
   currencies: every top-up waits for an admin until real samples are in.

## Deploy

Nothing here is deployed. With per-target approval, from a pushed commit:

1. `firebase deploy --only firestore:indexes` and wait for the new
   `transactions` index to build. **Before any function**: `sumSpendSince` fails
   closed without it, which stops every outbound payment.
2. The functions this branch changes, by name.
3. Hosting (`checkout.html`).
4. Customer app build.

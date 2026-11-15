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
| Zaad top-ups (`*220*` dial code, SMS `SLSH`), held payments, admin assign and refund | Yes: to a customer's wallet, or to an agent's shilling float (`agent:{uid}@SLS`) |
| P2P (`sendP2P`, `currency: "SLS"`) | Yes |
| Merchant API: charges (`currency: "SLSH"`), approval, refunds, webhooks, hosted checkout | Yes |
| Partner transfers (`POST /v1/transfers`, `currency: "SLSH"`) | Yes |
| `getBalance` (`slsBalance`), `getTransactions` (whole shillings) | Yes |
| Account deletion | Refused while shillings remain |
| Customer app: Home, Send, charge approval, history, Zaad top-up, agent top-up, cash-out | Yes (payment links into Send stay in dollars) |
| Agent cash-in and cash-out (`customerRequestAgentTopup`, `customerCashOut` with `currency: "SLS"`) | Yes, from and to the agent's shilling float `agent:{uid}@SLS`. See below |
| Float desk (`adminRequestFloat` with `currency: "SLS"`) | Yes: issue and withdraw shilling float |
| Disputes (`openDispute`, `adminResolveDispute`) | Yes: a remedy is paid in the disputed movement's currency. **The wait-for-funds reserve (D8) is dollars only**: a shilling claim the other party can't cover is refused (`insufficient_shillings`), to be paid from Zapp or retried. Disputes from before this were all recorded as dollars |
| Shop QR (`generateQRCode`, `processPayment`, `payMerchant`), customer-QR requests, payroll, remittance | **Dollars only** (`validateCurrency` refuses SLS) |
| Agents buying float by Zaad, and Move to float | Yes: the agent picks the currency in the merchant app; a shilling payment or wallet shillings become shilling float. See below |
| Merchant payouts to Zaad | **Dollars only** |
| Merchant app | Agent float, cash-in, cash-out, Buy float by Zaad, Move to float and history rows in shillings. **Shop balance and payouts dollars only on screen** |
| Admin console | Float desk in shillings. **Other balances dollars only on screen** |

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

## Before shillings are useful to Ridy drivers

Drivers paid in shillings need to turn them into cash. Next, in order:

1. ~~Agent shilling float, cash-in and cash-out~~: built (above).
2. ~~Agents buying shilling float themselves: by Zaad, and Move to float~~:
   built (below).
3. Payouts in shillings to the Zaad account on file.
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

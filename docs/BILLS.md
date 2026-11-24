# Bills

Shops send customers bills: a water company's monthly bill, a gym membership,
school fees. Customers can also ask a shop for a **direct payment** ("bill me
$25 every month for my membership"), which the shop approves. The customer pays a bill in Zapp Pay with Face ID or their PIN,
declines it, or turns on **auto-pay** for that shop so its bills up to a limit
they choose are paid on the due date.

Code: `functions/src/bills/`. Apps: customer `mobile/src/screens/bills/`
(Home → Bills), merchant `merchant-app/src/screens/bills/` (Dashboard → Bills).

## Who does what

| Who | Can | Callable |
|---|---|---|
| Shop (`merchant`, `agent_merchant`) | Send a bill to a phone number: amount (USD or SLS), what it's for, the customer's number with the shop (meter, member, student), due date (today to 90 days), once / weekly / monthly | `createBill` |
| Shop | Withdraw an unpaid bill; list its bills and repeating bills | `cancelBill`, `merchantListBills` |
| Customer | List bills, repeating bills and auto-pay settings | `listMyBills` |
| Customer | Pay a bill (PIN or Face ID token, amount must match what was shown) | `payBill` |
| Customer | Decline a bill (the shop is told) | `declineBill` |
| Customer | Turn on or change auto-pay for a shop that has billed them, with a most-per-bill limit (PIN) | `setBillAutopay` |
| Customer | Turn auto-pay off (no PIN: it only stops money leaving) | `disableBillAutopay` |
| Either | Stop a repeating bill | `stopBillSeries` |
| Customer | Ask a shop for a direct payment: shop (its number, or one that billed them), amount, what for, their number with the shop, weekly or monthly, first payment date (today to 60 days), and whether to pay automatically (PIN, or Face ID token, only then) | `requestDirectPayment` |
| Customer | Take back a request the shop hasn't answered | `cancelDirectPaymentRequest` |
| Shop | Approve or decline a request. Approving starts the repeating bill, sends its first bill (due on the requested date, or today if that has passed) and, if the customer asked, turns on auto-pay up to the requested amount (a higher limit they already set stays) | `answerDirectPaymentRequest` |
| Schedule | Every hour: send repeating bills due to go out, then auto-pay bills that have fallen due | `billsHourly` |

Sending a bill moves no money, so it takes no PIN.

## Collections (all server-only in `firestore.rules`)

- `bills/{billId}`: one bill. `billId` is `{merchantId}_{idempotencyKey}` for a
  bill sent by hand and `{seriesId}_{dueDate}` for one a repeating bill sent,
  so a retried send or a re-run schedule can't send it twice. Status
  `open → paid | declined | cancelled`.
- `billSeries/{seriesId}`: a repeating bill (`s_{billId}` of the first bill).
  The next bill is sent `issueDaysBefore` (3) days before it falls due. Monthly
  bills keep their day of the month (31 Jan → 28 Feb → 31 Mar).
- `billRequests/{customerId}_{idempotencyKey}`: a direct payment request,
  `pending → approved | declined | cancelled`. Approval links `seriesId`
  (`s_req_{requestId}`) and `firstBillId`.
- `billAutopay/{customerId}_{merchantId}`: the customer's auto-pay setting for
  one shop: `maxAmount`, `currency`, `active`.

Due dates are Hargeisa calendar days (`YYYY-MM-DD`); a bill falls due at the
midnight that starts its day (`dueAt`).

## Money

Paying a bill posts one entry, `bill_{billId}`, type `bill_payment`, the same
shape as a shop payment: customer debited, shop credited the amount less the
payment fee (`paymentFeeRate`), fee to `platform:fees`. One entry per bill,
whoever pays it, so a bill can't be paid twice. The `transactions` row is
`kind: "merchant_payment"` with `billId` (and `autopay: true` when auto-pay
paid it), so receipts, refunds (`bill_payment` is in `REFUNDABLE_ENTRY_TYPES`),
Zapp Business figures and the activity monitor treat it as a shop payment.

## Guards

A customer's own payment: App Check, PIN (or Face ID token), both accounts
active, the pause after a PIN reset or phone change (`shop_payment`
allowance), per-payment, daily and monthly limits, velocity, then the
ledger's own balance check.

Auto-pay: everything above except the PIN and velocity. The PIN was given when
auto-pay was turned on, and is the customer's consent for that one shop, in
that currency, up to that limit. The setting is re-read inside the posting
transaction, so turning auto-pay off a moment before a run still stops it.

Auto-pay tries a bill at most once in any 20 hours and three times in all,
and only within 7 days of its due date. Each failed try is recorded on the
bill (`autopayTries`, `autopayLastError`) and the customer is told; the bill
stays open for them to pay.

A direct payment request moves no money. With auto-pay, its PIN is the same
consent `setBillAutopay` takes, given before the shop has answered; it only
takes effect when the shop approves, and covers that shop up to the requested
amount. A customer may send 10 requests an hour and 30 a day (the
`billreq_` budget) and have 5 waiting at once.

Against spam and number-walking: each bill resolves a phone number and counts
against the shop's `bill_` lookup budget (60 an hour, 300 a day); a shop may
have at most 10 open bills with one customer; a bill over the customer's
single-payment limit is refused at send time. Customers can decline any bill
and stop any repeating bill.

## Pushes (`utils/pushTemplates.ts`, en/so/ar)

Customer: `bill.received`, `bill.received_autopay` (will be paid on the due
date), `bill.over_autopay_limit`, `bill.autopaid`, `bill.autopay_failed`.
Customer, for requests: `bill.request_approved` (opens the first bill),
`bill.request_declined`.
Shop: `bill.paid`, `bill.declined`, `bill.series_stopped`,
`bill.request_received`. Data carries
`type: "bill" | "bill_paid" | "bill_declined" | "bill_series"` and `billId`;
the customer app opens the bill, the merchant app opens Bills.

## Deploying

New: the callables above, `billsHourly`, the `billRequests` rules block, four indexes (`bills` by merchant or
customer and `createdAt`, by `status` and `dueAt`; `billSeries` by `active`
and `nextIssueAt`), and the rules block. `payBill` and `billsHourly` move
money: deploy them only with explicit go-ahead. Changed and shared with other
flows: `refundPayment` (accepts `bill_payment`), the activity monitor, and the
transaction-kind backfill helper. Deploy rules and indexes first, then the
functions by name, then ship the apps.

## Known limits

- The auto-pay pass reads up to 200 open bills due in the last 7 days per
  run. Bills not covered by auto-pay are read and skipped; at high volume
  they could crowd out covered ones, and auto-pay candidates should then be
  marked on the bill and queried directly.
- A refunded bill stays `paid`; the refund shows on the transaction.
- Customers can't yet block a shop from billing them; they decline bills and
  stop repeating ones.

# Table Connect: request the bill and pay from the table

*Drafted 2026-11-21. Status: proposal, nothing built yet.*

A diner scans a QR on the table (or the restaurant's counter QR and picks their table). That links their Zapp account to the table for this visit. When they're ready, they tap **Request bill**. The waiter still comes over and talks to them, and pushes the bill to the diner's phone. The diner checks it and approves with their PIN.

Ordering stays with the waiter. Only asking for the bill and paying it move to the phone.

---

## 1. Business study: Hargeisa

### 1.1 How a restaurant bill gets paid today

1. The diner waves the waiter over and asks for the bill.
2. The waiter walks to the counter, gets a total (usually handwritten or added up from memory), and walks back.
3. The diner pays one of three ways:
   - dials Zaad or eDahab USSD (`*220*<merchant number>*<amount>#`) and types the merchant number and the amount by hand;
   - pays cash;
   - one person in the group pays for everyone, which is common and a matter of hospitality.
4. The waiter waits for the SMS to arrive on the counter phone, or the diner shows their screen as proof.
5. At the end of the day the owner works out what was paid from SMS confirmations on two wallets.

Mobile money is the default here. Zaad is used by about 78% of adults ([GSMA](https://www.gsma.com/mobilefordevelopment/country/somaliland/somaliland-pushing-the-mobile-money-cva-frontier/), [TechCabal](https://techcabal.com/?p=66916)), and some Hargeisa merchants say well over 90% of their customers pay digitally ([The National](https://thenationalnews.com/world/africa/somaliland-s-world-leading-move-towards-a-cashless-culture-1.781506)). The friction in this process isn't cash. It's three things:

| Friction | Who it hurts | Cost |
|---|---|---|
| Typing a merchant number and an amount on USSD | Diner | A wrong number sends money to a stranger; a wrong amount means a dispute at the counter |
| Two or three trips by the waiter (bill, wait, check the SMS) | Waiter / owner | Table turnover at rush times, Ramadan iftar above all |
| "Did it arrive?" (waiting on an SMS, screenshots shown as proof) | Waiter, owner | Trust, plus a reconciliation job at the end of the day |

### 1.2 Why only the bill, and not QR ordering

- Service in Hargeisa is personal. Menus are short and ordering out loud is fast. Ordering on a phone adds steps here instead of removing them.
- Operators who rolled out QR ordering elsewhere found many guests still wave staff down, and that adoption depends on how staff behave ([HungryHungry](https://www.hungryhungry.com/en/blogs/get-customers-to-use-qr-code-ordering-at-table), [Hospitality Tech](https://hospitalitytech.com/trend-report-how-pay-table-technology-can-drive-revenue-0)). A feature that keeps the waiter in the loop works with staff instead of against them.
- Paying is where the risk sits: wrong number, wrong amount, "did it arrive?". Fixing payment gives most of the value with a small change.

### 1.3 Who gets what

| | Today | With Table Connect |
|---|---|---|
| **Diner** | Types a number and an amount, hopes it's right | Sees the restaurant's verified name, table, bill number and amount, then PIN. Gets a receipt |
| **Waiter** | Walks back and forth, checks the SMS | Sees "Table 4 wants the bill", sends the total from wherever they are, sees **Paid** on their screen |
| **Owner** | Reconciles SMS from two wallets | Every bill is tied to a table and a time. One report |
| **Zapp** | — | A reason for diners to install and use the app every day at the venues they visit most. The table QR also brings in new users |

### 1.4 Local factors the design must respect

- **One person pays for the group.** Split bills are rare. v1 sends the whole bill to one diner, and the waiter asks who is paying, as they do now. No split in v1.
- **Privacy, including family sections.** The waiter's screen shows a first name and the last 2 digits of the phone number, and nothing else. A diner can choose to show as "Guest".
- **Prayer breaks and long sittings.** Diners can sit for hours over tea. A table session doesn't expire on a short timer (see §2.3).
- **Ramadan iftar rush.** Ramadan 1448 starts around 8 February 2027. That peak is when the friction hurts most and where a pilot proves itself. Target: pilot live by mid-January 2027.
- **Most diners won't have Zapp yet.** Zaad still dominates. Scanning a table QR without the app opens a web page with the restaurant's name and "Pay with Zapp: get the app". Without the app, the diner pays the old way and nothing breaks.
- **Android first.** As in the GTM roadmap.

### 1.5 Pricing

- Same merchant fee as any Zapp QR payment (read from `config/rates`; GTM plan is 1%, with the first 90 days free). **No extra fee for tables.** It's a reason to choose Zapp, not a new revenue line.
- Zapp prints and supplies table tent-cards for pilot venues. The cost is low and it controls sticker quality (see the sticker-swap threat in §3).
- Optional for the pilot: a small marketing-funded bonus per paid bill to the venue's staff. Staff behaviour decides adoption.

### 1.6 KPIs for the pilot (3–5 venues in the Independence Ave / Jigjiga Yar corridor)

Measure two weeks of the current process with a stopwatch first, then run four weeks live.

| KPI | Target |
|---|---|
| Time from "bill please" to paid | Down 50% against the measured baseline |
| Share of bills at pilot venues paid through Table Connect | 20% by week 4 |
| **Wrong-bill reports per 1,000 bills** (rejected as "not my bill", plus refunds) | < 1. This is the trust metric |
| Installs that come from table QR scans | Tracked, no target yet |
| Diners who use it at a second visit | 40% |

### 1.7 Risks

| Risk | Mitigation |
|---|---|
| Staff ignore it | Train waiters on day one, keep the waiter's screen simple, optional staff bonus |
| Too few diners have Zapp | The table QR is also an install funnel; pick venues near universities first (GTM segment 3) |
| A wrong bill breaks trust early | See §3. Nothing is ever charged without the diner seeing it and entering their PIN |
| Waiters sharing the owner's merchant login | Not allowed: waiters sign in with their own Zapp account and an owner-granted Waiter role (`STAFF_ACCESS.md`), which is built before the pilot. The owner/cashier device works from day one |

---

## 2. How it works

### 2.1 Diner flow

1. **Scan** the table QR. The app shows the restaurant's verified name and logo and "Table 4". The diner taps **Join table**. *No money moves and no payment is authorised by joining.*
   - Counter QR instead: the app offers **Pay now** (today's flow) or **I'm at a table**, then a list of the restaurant's tables to pick from.
2. A slim banner, "At Café X · Table 4", stays in the app while the session is open.
3. Tap **Request bill**. This sets a flag on the waiter's screen. It doesn't replace talking to the waiter: it's the digital version of raising your hand.
4. The bill arrives: **Café X · Table 4 · Bill #0231 · $12.50**. The diner either approves with their PIN or taps **This isn't my bill**.
5. They see a receipt. The session closes.

### 2.2 Waiter / cashier flow (merchant app, new **Tables** tab)

The tab is available to the owner and to any staff member the owner has granted Waiter, Cashier or Manager (`STAFF_ACCESS.md`). A waiter sees Tables and nothing else: no balance, payouts or refunds.

- A board of tables. Each table lists its joined diners ("Amina ••47 · since 13:05") and shows a bill-request flag.
- Tap a diner → **Send bill**: amount, plus an optional bill number from the paper pad → sent.
- The board shows the state live: *Bill sent → Paid* (green, `#34C77B`), or *Rejected: "not my bill"*.
- Actions per diner: **Move to table…**, **Remove**. Per table: **Clear table**.
- **Print table QRs**: generates a printable sheet, one QR per table, and lets you reprint or revoke a single table's code.

### 2.3 Data model (sketch)

```
tables/{tableId}                 // tableId = random, unguessable; it *is* the QR payload
  merchantId, label ("Table 4"), active, createdAt

tableSessions/{sessionId}
  merchantId, tableId, tableLabel, customerId, displayName ("Amina ••47" | "Guest"),
  status: open | bill_requested | billed | paid | closed | expired,
  billRequestId?, openedAt, lastActivityAt, closedReason?
```

- The QR encodes `https://<hosting>/t/{tableId}`, which is a deep link for app users and a web fallback for everyone else. It never contains a raw merchant ID or an amount.
- **A diner has at most one open session.** Joining a new table closes the old session.
- Expiry: a session closes on payment, when the waiter clears it, when the diner leaves, or after `tableSessionIdleHours` (config, default 4h) of no activity.

### 2.4 Money: reuse, not a new flow

The bill is an ordinary **`paymentRequests`** document, the same one the counter flow creates after scanning a customer's code. It's approved by the existing `approvePaymentRequest` (`functions/src/customer-qr/approvePayment.ts`), which already handles:

- PIN verification, `enforceTransactionLimits`, `enforceVelocity`, the reset-cooldown, App Check;
- `expectedAmount`: the diner pays what they saw, or nothing;
- the journal entry `custqr_{requestId}` and the `transactions` row with `participants`.

What's new on the money path:

- **`raiseTableBill`** (merchant callable) creates the `paymentRequest` from a **session** instead of a scanned customer token. It's keyed `tbl_{sessionId}_{n}` so a retry returns the same bill (the same idempotency pattern as `createPaymentRequest`). It carries `origin: "table"`, `sessionId`, `tableLabel` and the bill number. The shared parts of `createPaymentRequest` (role check, `assertAccountActive`, per-transaction limit, expiry) move into one helper that both callables use.
- `approvePaymentRequest` marks the session `paid` **in the same Firestore transaction** that posts the entry.
- A table bill's lifetime is `tableBillTtlSeconds` (config, about 10 min) rather than the counter's short TTL. The diner may be finishing their tea. If it expires, the waiter resends it.

**No new journal template, no new accounts, no rate in code.** The ledger entry is identical to a counter QR payment. Run the `new-money-flow` checklist anyway, because the request now has a second origin.

### 2.5 Other callables / backend

| Function | Who | Does |
|---|---|---|
| `manageTables` | merchant | create, rename, revoke, reprint tables |
| `joinTable` | customer | open a session (closing any other); rate-limited |
| `requestBill` / `leaveTable` | customer | set the flag / close the session |
| `moveSession` / `removeSession` / `clearTable` | merchant | waiter corrections |
| `raiseTableBill` | merchant | see §2.4 |
| `expireTableSessions` | scheduled | idle expiry |

Rules: a merchant reads their own `tables` and `tableSessions`; a customer reads only their own sessions. All writes go through callables. New composite indexes go in `firestore.indexes.json` (sessions by `merchantId + status`, by `customerId + status`).

---

## 3. Trust: every way a bill can go wrong

The principle is that **bills are addressed to a person, not to a table.** The table is only how the person and the waiter find each other. The diner sees every bill and approves it with their PIN, so nothing is ever charged automatically.

| Scenario | What happens |
|---|---|
| **The party moves tables** | The session goes with the person. The waiter taps **Move to table 7**, or the diner scans table 7's QR, which closes the old session. Either way the bill reaches the same phone. The bill shows the table, so a mismatch is visible |
| **The next group sits at the same table** | The earlier session closed on payment, on Clear table, or by idle expiry. A new diner can never see or receive a bill raised for an earlier session |
| **Several phones at one table** | Each phone has its own session. The waiter picks *whose* bill it is by name ("Amina ••47"), after asking "who's paying?" as they do today. A second bill can't be sent to a session while one is pending |
| **Wrong amount, or someone else's order** | Before the PIN the diner sees the restaurant, the table, the bill number and the amount, and can tap **This isn't my bill** (uses `rejectPayment`). The waiter's screen shows the rejection straight away. After payment: the existing `refundPayment` and disputes flow |
| **The bill changes after it's been sent** (an extra tea) | The waiter cancels and resends (`cancelPayment`). `expectedAmount` guarantees the diner never pays a different figure from the one shown |
| **Someone joins from a photo of the QR, away from the restaurant** | They gain nothing: joining moves no money and shows no bills. They appear on the waiter's board, where the waiter can **Remove** them, and joining is rate-limited |
| **A fraudster pastes their own QR over the table's** | The app only accepts Zapp table links, and shows the *verified* merchant name and logo at join and on the bill. A rogue "merchant" is a KYC'd account that can be traced and frozen. Zapp supplies tamper-evident tent-cards. Waiters are trained to say the restaurant's name ("you'll see Café X") |
| **A waiter overcharges** | Every bill carries `raisedBy` (the waiter's own account) and the time. The owner sees bills by waiter, and the diner is protected by seeing the amount before paying |
| **A waiter leaves the job** | The owner taps Remove, and the waiter's next call is refused. They never had the owner's login, so there's nothing to change |
| **The connection drops mid-payment** | The approval is idempotent per request ID and the receipt is recovered on retry. The waiter only sees *Paid* once the entry has been posted |
| **The diner leaves without paying** | Same as today: a human problem. The open session at least tells the waiter who it was |

---

## 4. Build phases

| Phase | Scope | Notes |
|---|---|---|
| **1. Staff access** | Owner-granted Waiter / Cashier / Manager roles for the merchant app and Zapp Business sign-in (`STAFF_ACCESS.md`) | Comes first: the Tables callables are built on `requireMerchantActor` from the start |
| **2. Backend** | §2.3–2.5, shared request helper, `raisedBy` on bills, rules, indexes, Jest tests (move, rescan, stale session, double bill, reject, wrong customer, expiry, waiter scope) | Deploying a new money-path callable to prod needs explicit authorisation |
| **3. Merchant app** | Tables tab, print QRs, Send bill, live states, move / clear | en/so/ar; dark-glass style; for the owner/cashier device and staff mode |
| **4. Customer app** | Scanning table links, Join sheet, banner, Request bill, reuse the bill-approval screen, "This isn't my bill" | en/so/ar; simulator first |
| **5. Pilot** | 3–5 venues, baseline then live, KPIs in §1.6, waiters on their own accounts | Target mid-January 2027, ahead of Ramadan |
| Later | Split bill, tips, a web pay page for card-funded diaspora visitors | Only if the pilot asks for them |

## 5. Open decisions

1. ~~Staff devices~~: decided 2026-11-21. Both: the owner/cashier device from day one, and owner-granted staff access before the pilot (`STAFF_ACCESS.md`).
2. **Idle expiry.** Is 4h right for Hargeisa sittings?
3. **Diner display.** First name + ••2 digits by default, or "Guest" by default?
4. **Staff bonus per paid bill** during the pilot: yes or no, and who funds it?

# Staff access: owner-granted roles for the merchant app and Zapp Business

*Drafted 2026-11-21. Status: the first slice (grants, cashier counter charges, manager sign-in to Zapp Business, owner Staff screen and staff mode) is merged (PR #41) and live in prod since 2026-11-21. Manager refunds are built on branch `feat/manager-refunds`, not deployed. Not yet built: a cashier incoming-payments feed, and Tables (`TABLE_CONNECT.md`).*

## Why

Today a shop is one login. Anyone who works the till either uses the owner's phone or knows the owner's number and PIN. With either, they can pay out, refund, see the balance, and sign Zapp Business (the web portal, `portal/`) in with the owner's full read access. Table Connect puts the merchant app in waiters' hands, so this has to be fixed first.

**Rule: staff have no access unless the main merchant account grants it, and the grant can be withdrawn instantly.** This applies to the merchant app and to the Zapp Business web sign-in.

## Principles

1. **A staff member uses their own Zapp account** (their own phone, OTP, PIN and KYC). They never use the owner's login or PIN. A bonus: every waiter becomes a Zapp user.
2. **Deny by default.** Access comes only from an owner grant. Some powers can never be granted (see the table).
3. **Checked on every call, server-side.** The grant is read from Firestore on each request, not stored in a cached custom claim, so revoking takes effect on the next request rather than up to an hour later.
4. **Every action records who did it** (`actorUid`), alongside the shop it was done for.
5. **Staff never move money into or out of their own wallet** through staff mode. Bills and charges credit the shop's wallet; refunds debit it.

## Roles (fixed presets in v1)

| Capability | Waiter | Cashier | Manager | Owner |
|---|---|---|---|---|
| Tables board, send table bill, move/clear table | ✓ | ✓ | ✓ | ✓ |
| Counter charge (scan customer code, show shop QR) | | ✓ | ✓ | ✓ |
| Incoming payments feed *(not built yet)* | own bills | ✓ | ✓ | ✓ |
| Refund | | | ✓ own PIN, only once the owner sets both caps | ✓ |
| Zapp Business web: takings, sales, transactions, CSV | | | ✓ read-only | ✓ |
| Zapp Business web: customer names and history | | | only if the owner ticks "Show customers" | ✓ |
| Shop balance | | | | ✓ |
| **Never grantable:** payouts, auto-payout, payroll, API keys, staff management, store links, agent float / cash-in / cash-out, PIN or phone changes | | | | ✓ |

Agent accounts (`topup_agent`, `agent_merchant`) can add staff for the shop side only. Float stays owner-only in v1 because it is pre-purchased value.

## How it works

**Granting**
1. In the merchant app, the owner opens **Settings → Staff → Add**, enters the staff member's phone number (`normaliseSomaliPhone`), picks a role and confirms with the owner's PIN.
2. The staff member gets a push notification and accepts it in the app. The grant becomes active. This is the same invite → respond pattern as store links (`portal/groups.ts`).
3. The owner can change the role, suspend or remove the staff member at any time.

**Data**
```
merchantStaff/{merchantUid}_{staffUid}     // server-only
  merchantUid, staffUid, role: waiter | cashier | manager,
  status: invited | active | suspended | revoked,
  showCustomers?: boolean, refundCapCents?: number, refundDayCapCents?: number,
  invitedBy, invitedAt, acceptedAt?, revokedAt?
merchantStaffAudit/{autoId}                // server-only, append-only: grant, role change, revoke
```
- A grant is effective only while it is `active` *and* both accounts are active (a frozen staff or owner account means no access).
- Maximum staff per shop: `MAX_STAFF_PER_SHOP` = 20 (`functions/src/staff/types.ts`), like `MAX_LINKED_STORES`.

**Merchant app**
- A staff member signs in with their own number. If they hold active grants, the app opens **staff mode** for that shop, with a picker when they have more than one. Only the tabs their role allows are shown, with no balance and no settings beyond their own.
- Every merchant callable that staff may use resolves the caller through one helper, `requireMerchantActor(request, merchantUid, capability)`. The helper returns `{merchantUid, actorUid, role}` or refuses the call. Callables that today treat `request.auth.uid` as the merchant keep doing so for the owner. Staff calls name the shop, and the helper verifies the grant.

**Zapp Business web sign-in**
- Sign-in is unchanged for the user: the browser shows the QR and a phone approves it with a PIN (`approvePortalLogin`). Staff approve it from their own phone with their own PIN.
- `approvePortalLogin` accepts a staff caller only with an active Manager grant. The session records `actorUid` and `role`, and the claims gain `portalActor` and `portalRole`.
- `requirePortalViewer` re-checks the grant on **every** call, so a removed manager's open tab stops working at once. `portalGetCustomers` and `portalGetCustomer` refuse unless the role is owner, or manager with `showCustomers`.
- The owner's list of signed-in computers shows who signed each one in ("Chrome on Windows · Hodan (manager)").

**What the first slice does**
- `functions/src/staff/`: `staffInvite`, `staffRespond`, `staffUpdate`, `staffRemove`, `staffLeave`, and `requireMerchantActor`.
- Counter charge: `scanCustomerToken`, `createPaymentRequest` and `cancelPaymentRequest` take `merchantId` for staff. A scan is the scanner's own (`scannedByActor`), so a colleague, or the shop itself, can't raise a charge on it. Staff can't raise cash-outs. Staff cancel only their own charges. `raisedBy` goes on the request and the `transactions` row, but not on `participants`.
- Zapp Business: `describePortalLogin` and `approvePortalLogin` take `merchantId` for a manager, who approves with their own PIN. The session stores `actorUid`, `actorName`, `role` and `showCustomers`. `requirePortalViewer` re-checks the grant on every call. A manager session never sees the balance or linked stores, and sees customers only with `showCustomers`, which the rules (`canViewCustomers`) enforce for direct reads too. Any grant change ends that person's sessions, and so does their own `endSessions` (PIN change, freeze).
- **Who paid is a customer detail.** Without `showCustomers` a manager gets no names anywhere: `portalListTransactions` blanks `counterpartyName`, and the live feed keeps its names in `merchantStats/{shop}/live/recentNames`, which only `canViewCustomers` may read (the feed itself, `live/recent`, carries none). Feeds written before that change still have names on their items until the shop's next sale, so `approvePortalLogin` moves them (`moveLegacyFeedNames`) before such a manager's session exists.
- **An open tab leaves at once.** A portal sign-in may read its own `portalSessions/{sid}` doc (only its own), and the web app watches it: the moment the session ends (removed, access changed, signed out from the phone, expired) the tab signs out and drops what it showed, without waiting for its next call.
- **Telling staff.** When the shop removes someone, or withdraws an invitation, their app says so ("Café Hargeisa removed you as staff") instead of quietly leaving staff mode. Leaving or declining themselves raises nothing.
- Merchant app: Settings → Staff (owner), and staff mode (`useMerchantOnboardingGate` state `staff`, `StaffNavigator`) with invites, a shop picker, Charge a customer, and Sign a computer in.

**Removing someone**
- The owner taps **Remove**. The grant is marked `revoked`, all that person's portal sessions are ended (`endPortalSession` per session), and their next merchant-app call is refused.
- Bills they already sent stay valid: they are the shop's bills, not the staff member's.

**Money paths**
- **Table bills and counter charges** are not debits from the shop, so staff don't need a PIN to send them. The diner still approves with their own PIN. `raisedBy: actorUid` is written on the `paymentRequest` and copied to the `transactions` row.
- **Refunds by a manager** debit the shop's wallet, never the manager's. `refundPayment` takes `merchantId` for a manager (`requireMerchantActor(…, "refund")`; only the manager role has the `refund` capability). The ledger entry is the shop's own refund (`refundCore`), unchanged except that the manager is `postedBy` and `refs.actorUid`, and the refund row carries `raisedBy`. The manager confirms with their own PIN; the PIN-reset pause applies to the shop and to the manager.
  - **Caps (decided 2026-11-21).** Off by default: a manager can't refund until the owner sets both `refundCapCents` (most for one refund) and `refundDayCapCents` (most in a Hargeisa day) on the grant, in US cents, with shillings counted at `slsPerUsd`. Highest settable: $1,000 a refund, $5,000 a day (`MAX_REFUND_CAP_CENTS`, `MAX_REFUND_DAY_CAP_CENTS`). The owner sets them in Settings → Staff → Change with their PIN (`staffUpdate`); a cap-only change is audited and doesn't sign the manager's computers out. A role change away from manager drops them.
  - **The day total** is `staffRefundDays/{grantId}_{YYYY-MM-DD}` (server-only), read and written inside the refund's own transaction, so two refunds at once can't both slip under the cap. A retried partial refund (same idempotency key) isn't counted twice.
  - **Partial refunds** are allowed within the caps; each part counts.
  - **Never their own payment.** A manager can't refund a payment they made themselves, which would put the shop's money into their own wallet (principle 5). `refundPayment` refuses it before the PIN check (`staff_refund_own_payment`), and `staffListPayments` leaves those payments off the manager's list. The owner can still refund them.
  - **Finding the payment:** `staffListPayments` returns the shop's last 50 counter payments still inside the refund window (online/API payments excluded), with the caps and what's used today. Names only with "Show customers".
  - **The shop is told** about every manager refund (`staff.refunded` push).

## Deploying

The first slice went out on 2026-11-21 in this order, and the order matters:

1. **Rules and indexes first** (`firebase deploy --only firestore`). The web app watches its own session doc; an app that ships before the rule allowing that read would be refused, read that as the session ending, and sign every open Zapp Business tab out.
2. **Functions, by name, from a pushed commit:** the staff callables, the counter-charge callables (money path: needs explicit per-target authorization), the portal callables, and `merchantStatsOnTransaction` (it now writes names to `live/recentNames`).
   - **Manager refunds** (`feat/manager-refunds`): rules (the `staffRefundDays` block), then `refundPayment` (money path: explicit per-target authorization), `staffUpdate`, `staffListPayments`. Nothing else changes behaviour. Then the merchant app.
3. **The portal right after the functions.** Between the two, the old portal still looks for names on the feed's items, so an owner's Live card shows "Customer" for new sales until the new portal is up.
4. **The merchant app** last (TestFlight only when asked).

## Build order

1. Backend: `merchantStaff`, invite / accept / change / revoke callables, `requireMerchantActor`, audit log, tests. Tests cover: revoke mid-session, frozen staff, frozen owner, a waiter calling a cashier function, a manager over the cap, and staff trying any never-grantable callable.
2. Merchant app: the Staff screen for owners and staff mode (en/so/ar).
3. Portal: staff sign-in, a per-role view, and "who signed in" (en/so/ar).
4. Table Connect builds on this (`TABLE_CONNECT.md` §4).

**Dependency:** Zapp Business (`portal/`, `functions/src/portal/`) and Bills live on branch `claude/direct-payment-push-receipt` (worktree `.claude/worktrees/mandate-push-receipt-eb44c9`), not on the current branch. The portal part of this work must build on that branch, or start after it is merged.

## Open decisions

1. Are the three fixed roles enough for v1, or do owners need per-permission ticks?
2. ~~What should the default manager refund cap be?~~ Decided 2026-11-21: off until the owner sets both caps; partial refunds allowed within them; managers find payments in a recent-payments list.
3. Should a cashier see the day's total takings, or only individual payments?

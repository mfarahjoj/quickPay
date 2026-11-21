# Staff access: owner-granted roles for the merchant app and Zapp Business

*Drafted 2026-11-21. Status: first slice built on branch `feat/staff-access` (not deployed): grants, cashier counter charges, manager sign-in to Zapp Business, owner Staff screen and staff mode in the merchant app. Not yet built: manager refunds, a cashier incoming-payments feed, and Tables (`TABLE_CONNECT.md`).*

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
| Refund *(not built yet; a money-path change)* | | | ✓ own PIN, up to the owner-set cap | ✓ |
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
  showCustomers?: boolean, refundCapCents?: number,
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
- **Refunds by a manager** debit the shop. They go through the existing `refundCore` with the manager's PIN, `refundCapCents`, velocity checks, and `actorUid` on the refund entry's `refs`. Run the `new-money-flow` checklist on this change.

## Deploying

Nothing here is deployed. When it is, the order matters:

1. **Rules and indexes first** (`firebase deploy --only firestore`). The web app watches its own session doc; an app that ships before the rule allowing that read would be refused, read that as the session ending, and sign every open Zapp Business tab out.
2. **Functions, by name, from a pushed commit:** the staff callables, the counter-charge callables (money path: needs explicit per-target authorization), the portal callables, and `merchantStatsOnTransaction` (it now writes names to `live/recentNames`).
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
2. What should the default manager refund cap be (for example $20 per refund, $100 per day)?
3. Should a cashier see the day's total takings, or only individual payments?

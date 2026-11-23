# Zapp Pay Counter Display: plan

A website for a tablet on the shop counter. It always shows the right QR code for the
shop, follows what the cashier types on the merchant app, and reads customers' Zapp
codes with a USB/Bluetooth scanner or the tablet's camera.

Repo: `~/quickPay-light` (worktree of `quickPay`), branch from `main` (`24588d9`, local
only). Prod Firebase project: `quickpay-485417`. Read `CLAUDE.md` in the repo root first:
its money invariants, i18n rule and deployment discipline all apply here.

---

## 1. Context

Today a sale lives on the cashier's phone. The cashier types the amount (Receive), taps
**Show QR**, and turns the phone to the customer, or taps **Scan customer** and scans
the customer's code with the phone camera. The shop's own code (**My QR**) is on a
separate screen.

The request: a customer-facing tablet that does the showing and the scanning, so the
phone stays in the cashier's hand.

Decisions already made by the user:

| Question | Answer |
|---|---|
| What is "the table"? | A tablet on the counter, facing the customer |
| Scanner | USB/Bluetooth QR scanner as the main way, tablet camera as backup |
| Customer scans before an amount is typed | Tablet asks them to wait; nothing is charged |
| Counters per shop at launch | One. Every linked tablet mirrors the shop's current sale |

## 2. Assessment of the idea

The idea is sound and needs **no change to how money moves**. Every payment still goes
through the existing callables (`processPayment`, `payMerchant`, `approvePaymentRequest`),
with the customer's PIN on the customer's own phone. The tablet only shows codes and
forwards a scanned customer code.

What the one-line plan leaves open, and how this plan closes each gap:

| Gap | Why it matters | Resolution (section) |
|---|---|---|
| How does a tablet prove which shop it belongs to? | A tablet showing the wrong shop's QR sends customers' money to the wrong shop | Pairing with a code scanned by the merchant app, PIN, and a confirm tap on the tablet (5) |
| What identity does a browser on a shared tablet get? | `requireAuth` accepts any signed-in user, and `setupPin` creates an account for one. A tablet must never be a "user" | No Firebase Auth on the tablet at all (4.1) |
| How do changes reach the tablet instantly? | The QR must appear when the cashier taps, and "Paid" when the customer pays | One server-written state doc per tablet, live listener (4.2, 6) |
| What does "correct QR all the time" mean? | Idle, sale, expired, paid, offline all need a defined screen | State machine (7.2) |
| A scan has no amount | The tablet must not be able to choose what a customer is charged | A scan only attaches to the sale the cashier already opened (8) |
| QR and scanner are both live for one sale | The sale could be paid twice | One transaction voids the QR and raises the request (8) |
| "Connect a scanner to a website" | Browsers can't talk to scanners directly | Scanners in keyboard mode; camera fallback (9) |
| Tablet sleeps, loses Wi-Fi, has a wrong clock | A dark or stale screen at the counter | Wake lock, reconnect, server clock offset, heartbeat reconcile (7.4) |

## 3. What gets built

```
display/                       NEW  Vite + React + TS site (same stack as admin/)
functions/src/counterDisplay/  NEW  pairing, state, scan, heartbeat, triggers
merchant-app/src/              EDIT link/list/unlink displays; follow a tablet scan
firestore.rules, firestore.indexes.json, firebase.json, .firebaserc   EDIT
COUNTER_DISPLAY.md             NEW  flow, threat model, setup, runbook (like CASH_IN_CASH_OUT.md)
```

**Do not modify** `processPayment.ts`, `payMerchant.ts`, `approvePayment.ts`,
`createPaymentRequest.ts`, `scanToken.ts`, or anything under `functions/src/ledger/`.
*Reasoning:* the feature can be built entirely beside the money paths. Leaving them
untouched means no money function is redeployed, existing tests stay valid, and
CLAUDE.md's per-target authorization rule is only triggered by the few non-money edits
listed in section 12.

## 4. Architecture

### 4.1 The tablet has no Firebase Auth identity

The tablet holds three random values, issued at pairing and kept in `localStorage`:

- `displayId` (`cd_` + 24 hex): names the tablet.
- `displaySecret` (64 hex): sent with every call the tablet makes. Server stores only
  its SHA-256.
- `stateKey` (64 hex): the document id of the tablet's state doc.

*Reasoning, considered and rejected: a Firebase custom token with a `role: display`
claim.* In this codebase `requireAuth` (`functions/src/utils/validation.ts:85`) only
checks that `request.auth` exists, and `isAuthenticated()` in `firestore.rules` is
`request.auth != null`. A display principal would pass both. `setupPin` would create a
user and wallet for it. Making that safe means auditing ~130 callables and every rule.
With no Auth identity, a tablet can do exactly what the display callables allow and
nothing else, and no existing guard has to change.

### 4.2 One state doc per tablet, written only by the server

`counterDisplayStates/{stateKey}`. The tablet listens to this one document. Rules allow
`get` to anyone who knows the id and nothing else:

```
match /counterDisplayStates/{stateKey} {
  allow get: if true;      // the id is a 256-bit secret; it is the capability
  allow list: if false;
  allow write: if false;
}
match /merchantDisplays/{id}     { allow read, write: if false; }
match /displayPairings/{id}      { allow read, write: if false; }
match /display_rate_limits/{id}  { allow read, write: if false; }
```

*Reasoning:* the doc holds only what the tablet shows to the public anyway (shop name,
QR payloads, amount, the payer's first name). A leaked `stateKey` lets someone watch a
counter screen remotely, read-only. It never lets them act. `list: false` means ids
cannot be enumerated. This is the same pattern as the public `config/app_client` doc.

Schema (millis as numbers, so the web app compares them against a server-corrected
clock):

```ts
interface CounterDisplayState {
  v: 1;
  merchantName: string;
  idleQr: string;            // My QR payload, identical to generateMerchantSticker's
  mode: 'idle' | 'sale' | 'approving' | 'unavailable';
  sale?:    { id: string; qrData: string; amountCents: number; currency: 'USD';
              reference?: string; createdAtMs: number; expiresAtMs: number };
  request?: { id: string; amountCents: number; currency: 'USD';
              customerFirstName: string; createdAtMs: number; expiresAtMs: number };
  flash?:   { kind: 'paid' | 'declined' | 'expired'; amountCents: number;
              receiptNumber?: string; atMs: number; showUntilMs: number };
  lang: 'en' | 'so' | 'ar';  // merchant's preferredLanguage; tablet can override
  derivedAtMs: number;
  updatedAt: FirebaseFirestore.Timestamp;
}
```

Never put fees, net amounts, balances, full customer names, or ids of people in it.

### 4.3 Other collections (all server-only)

```ts
// merchantDisplays/{displayId}
{ merchantId, name, status: 'pending_confirm'|'active'|'revoked',
  secretSha256: string|null, stateKey: string|null,
  secretFailedAttempts, secretLockedUntil,
  createdAt, confirmedAt, lastSeenAt, lastError?: string, appBuild?: string }

// displayPairings/{pairingId}   (pairingId = 'dp_' + 24 hex)
{ secretSha256, code /* 8 digits */, status: 'waiting'|'claimed'|'completed'|'declined',
  displayId?, merchantId?, merchantName?, createdAt, expiresAt /* +5 min */,
  expireAt /* Firestore TTL, +1 day */ }

// display_rate_limits/{key_bucket}   fixed one-minute windows, with expireAt
```

Ids and secrets come from `generateSecureId(nBytes)` in `functions/src/utils/encryption.ts`.

## 5. Pairing

```
Tablet                         Server                          Merchant app
  | startDisplayPairing ------> | creates displayPairings        |
  | <- pairingId, secret, code  |                                |
  | shows QR + 8-digit code     |                                |
  |                             | <------ linkDisplay(code, pin) | scans QR or types code
  |                             | creates merchantDisplays       |
  |                             |   (pending_confirm)            | "Now tap Confirm on the tablet"
  | pollDisplayPairing (2 s) -> |                                |
  | <- claimed, "Hodan's Shop"  |                                |
  | "Link to Hodan's Shop?" tap |                                |
  | confirmDisplayPairing ----> | status active, issues          |
  | <- displayId, displaySecret,|   displaySecret + stateKey,    |
  |    stateKey                 |   writes first state doc       | list shows "Online"
```

Tablet QR payload: `{"type":"zapp_display_pair","v":1,"id":"dp_…","code":"12345678"}`.

Callables in `functions/src/counterDisplay/pairing.ts`:

| Callable | Caller | Checks |
|---|---|---|
| `startDisplayPairing` | tablet, no auth | App Check; display web app id (4.4); 6/min per hashed IP |
| `linkDisplay({pairingId?, code, name?, pin})` | merchant app | `requireAuth`; App Check; account type `merchant`/`agent_merchant`; `assertAccountActive`; `verifyUserPin` (shared PIN lockout); wrong-code lockout; at most 3 active displays |
| `pollDisplayPairing({pairingId, pairingSecret})` | tablet | App Check; secret hash; 60/min per pairing |
| `confirmDisplayPairing({pairingId, pairingSecret, accept})` | tablet | same; only from `claimed` (or `completed` within the window, see below) |

Rules that need care:

- **Wrong-code lockout on `linkDisplay`.** Follow the reserve-first pattern of
  `reserveOtpAttempt` / `clearOtpFailures` (`functions/src/utils/otpGuard.ts`), but with
  its own fields (`displayLinkFailedAttempts`, `displayLinkLockedUntil`) so a bad
  pairing code never locks an agent out of cash-in. Reserve the attempt *before* the
  lookup, give it back on success.
- **Typed code without `pairingId`.** Look up `displayPairings` where `code == X` and
  `status == 'waiting'` and not expired. If more than one matches, refuse and ask the
  cashier to scan the QR.
- **Confirm on the tablet is mandatory.** *Reasoning:* the pairing code is on a public
  screen. Someone nearby could photograph it and link *their* shop first; customers
  would then pay the attacker. The confirm step shows the shop name on the tablet,
  where the real owner sees the wrong name and taps No. Until confirm, no state doc
  exists and the tablet shows no QR.
- **Lost reply to confirm.** If `confirmDisplayPairing` is called again while the
  pairing is `completed` and still inside its 5-minute life, issue a *new*
  `displaySecret` and `stateKey`, delete the old state doc, return the new values.
  Otherwise a dropped response would leave a tablet that can never finish.
- **Decline** deletes the `merchantDisplays` doc and marks the pairing `declined`.

Managing displays (`manage.ts`): `listMyDisplays`, `renameDisplay`, `unlinkDisplay`
(merchant, `requireAuth`), and `displaySignOut` (tablet). Unlinking sets `revoked`,
clears `secretSha256`, and deletes the state doc. The tablet sees the doc vanish and
returns to the pairing screen.

Account deletion: add a step to `functions/src/auth/deleteAccount.ts`, beside the
existing `trustedDevices` cleanup (line ~69), that revokes the merchant's displays and
deletes their state docs.

### 4.4 Guard for every tablet call (`guard.ts`)

`requireDisplay(request)` returns `{ display, merchant }` or throws:

1. Function option `enforceAppCheck: true`.
2. `request.app?.appId` must equal the param `DISPLAY_WEB_APP_ID`
   (`defineString`); skip when the param is empty (tests, emulator).
   *Reasoning:* App Check alone accepts tokens from the customer and merchant apps too.
   Pinning the app id means only the display site can call display endpoints.
3. Shape checks: `displayId` `^cd_[a-f0-9]{24}$`, `secret` `^[a-f0-9]{64}$`.
4. Rate limit 120/min per display: copy the blind-increment-then-read pattern of
   `enforceApiRateLimit` (`functions/src/api/requestGuards.ts`) into
   `counterDisplay/rateLimit.ts`, writing `display_rate_limits`, throwing
   `HttpsError('resource-exhausted')`.
5. Load `merchantDisplays/{displayId}`; `status == 'active'`; compare
   `sha256(secret)` with `crypto.timingSafeEqual`. On mismatch increment
   `secretFailedAttempts`, lock for 15 minutes after 10 (mirror
   `functions/src/auth/trustedDevice.ts:238-252`). Reason code `display_revoked` when
   revoked, so the tablet knows to forget itself.
6. Load `users/{merchantId}`; `assertAccountActive`; account type check.

## 6. Keeping the state doc right

One function is the only writer: `syncCounterState(db, merchantId, opts?)` in
`functions/src/counterDisplay/state.ts`.

```ts
export async function syncCounterState(db, merchantId, opts: { flash?: Flash } = {}) {
  const displays = await db.collection('merchantDisplays')
    .where('merchantId', '==', merchantId).where('status', '==', 'active').get();
  if (displays.empty) return;                    // one cheap read for shops with no tablet
  const derivedAtMs = Date.now();                // taken BEFORE the source reads
  const truth = await deriveCounterState(db, merchantId, derivedAtMs);
  await Promise.all(displays.docs.map((d) =>
    writeState(db, d.get('stateKey'), truth, opts.flash)));
}
```

`deriveCounterState` reads the source of truth; it never applies a delta:

1. Merchant: `users/{id}` + `merchantProfiles/{id}`. Not active → `mode: 'unavailable'`.
   `merchantName` exactly as `generateQRCode` picks it (`generateQR.ts:118-121`).
2. `idleQr`: move the payload construction in
   `functions/src/merchants/generateMerchantSticker.ts` (lines 62-73) into an exported
   `buildStickerPayload(userId, merchantName, businessAddress)` and call it from both
   places, so the tablet's My QR is byte-identical to the phone's.
3. Newest pending shop request: `paymentRequests` where `merchantId ==`, `status ==
   'pending'`, order `createdAt desc`, limit 5; drop `purpose == 'cash_out'`; drop
   expired (`requestExpiryMillis` from `customer-qr/requestExpiry.ts`).
4. Newest active sale: `qrCodes` where `merchantId ==`, `status == 'active'`, order
   `createdAt desc`, limit 1; drop if `expiresAt` has passed.
5. Mode = `approving` or `sale`, whichever is newer by `createdAt`; else `idle`.
   *Reasoning:* a tablet scan voids the QR, so normally only one exists. "Newest wins"
   gives a defined answer if two phones on one shop account open sales at once (one
   counter per shop at launch).

`writeState` runs in a transaction on the state doc:

- Existing `derivedAtMs` newer than ours → keep the existing mode fields (a later
  derivation already landed).
- Flash rules: a provided flash replaces an older one. An existing flash is **kept**
  unless `showUntilMs` has passed or the derived sale/request was created after
  `flash.atMs`. *Reasoning:* a new sale must clear "Paid", but an unrelated re-sync must
  not wipe it before the customer has seen it.
- `showUntilMs` is `atMs + 8000` for paid, `+5000` otherwise, where `atMs` comes from
  the source doc (`usedAt`, `resolvedAt`, `createdAt`), never from "now", so a
  redelivered event cannot extend the flash.
- Skip the write when nothing changed.

Who calls it:

| Caller | When | File |
|---|---|---|
| `generateQRCode`, `cancelQRCode` | inline after their write, `await …catch(log)` | `functions/src/qr-payments/generateQR.ts`, `cancelQR.ts` |
| Firestore trigger on `qrCodes/{id}` written | re-derive | `counterDisplay/triggers.ts` |
| Firestore trigger on `paymentRequests/{id}` written | re-derive; flash `declined` on pending→rejected, `expired` on pending→expired; ignore `cash_out` | same |
| Firestore trigger on `transactions/{id}` created | flash `paid` when `kind == 'merchant_payment'`, `type == 'payment'`, `status == 'completed'`; merchant is `toUserId` | same |
| `displayScanCustomer`, `confirmDisplayPairing` | inline | `scan.ts`, `pairing.ts` |
| `displayHeartbeat` | every 60 s per tablet, on boot and on reconnect | `heartbeat.ts` |

*Reasoning for this mix.* The triggers mean the money functions need no edits: every
successful payment (dynamic QR, My QR, approved request) already creates exactly one
`transactions` row with `kind: 'merchant_payment'`, which is the single "paid" signal.
The two inline calls exist only for speed: the QR should reach the tablet as the phone
gets its reply, without waiting on a trigger cold start. The heartbeat is the heal path:
whatever was missed is corrected within a minute, because every caller re-derives from
the source rather than patching. Trigger pattern to copy: `onApiChargeWritten` in
`functions/src/api/webhooks.ts:393`.

Measure paid→flash latency in the pilot. If p95 is over 2 seconds, set
`minInstances: 1` on the three triggers. Only if that is still not enough, propose an
inline post-commit sync in the money functions to the user as a separate change.

`displayHeartbeat({displayId, secret, appBuild, lastError?})`: `requireDisplay`; update
`lastSeenAt` (skip if written under 50 s ago); `syncCounterState` for the merchant;
return `{ serverNowMs, latestBuild }`.

Indexes to add in `firestore.indexes.json`:

- `qrCodes`: `merchantId ASC, status ASC, createdAt DESC`
- `paymentRequests`: `merchantId ASC, status ASC, createdAt DESC`

## 7. The display site (`display/`)

### 7.1 Stack and layout

Copy the shape of `admin/`: Vite 6, React 18, TypeScript, `firebase` ^11, App Check
with `ReCaptchaEnterpriseProvider`, config from `VITE_*` env vars, and the same
build-time refusal when config or the App Check key is missing (`admin/vite.config.ts`,
`admin/src/firebase.ts`). Add `qrcode.react` (QR rendering), `qr-scanner` (camera), and
`vitest`.

```
display/src/
  firebase.ts            app, App Check, Firestore, Functions (no Auth import)
  api.ts                 typed wrappers for the tablet callables
  storage.ts             creds + last idle state in localStorage
  state/viewModel.ts     pure: (creds, stateDoc, nowMs, online) -> screen   + tests
  state/useCounterState.ts   onSnapshot, clock offset, 1 s ticker
  scanner/tokenFormat.ts normalise a scanned string                         + tests
  scanner/hidScanner.ts  pure keystroke assembler                           + tests
  scanner/CameraScanner.tsx
  kiosk/wakeLock.ts, fullscreen.ts, heartbeat.ts, version.ts
  screens/Pairing, ConfirmLink, Idle, Sale, Approving, Flash, Unavailable, Setup
  i18n/en.json, so.json, ar.json   (Arabic sets dir="rtl")
```

### 7.2 Screens: `viewModel` decides, in this order

| Condition | Screen | Shows |
|---|---|---|
| No creds | Pairing | Pairing QR, 8-digit code, "Open Zapp Pay Merchant → Settings → Counter display" |
| Pairing claimed | ConfirmLink | "Link this screen to **{shop}**?" Yes / No |
| State doc missing, or heartbeat says `display_revoked` | (clear creds) → Pairing | "This screen was unlinked" for 5 s |
| `mode == 'unavailable'` | Unavailable | "This shop can't take payments right now" |
| `flash` and now < `showUntilMs` | Flash | Paid: green tick, amount, receipt number. Declined / Expired: plain message |
| `mode == 'approving'` and request not expired | Approving | "{firstName}, approve {amount} on your phone", countdown |
| `mode == 'sale'` and sale not expired | Sale | "Pay to {shop}", amount, note, QR, countdown, "Scan with Zapp Pay, then enter your PIN"; plus "or hold your Zapp code to the scanner" when a scanner is on |
| otherwise | Idle | My QR: "Pay to {shop}", large QR, "Scan with Zapp Pay and type the amount" |

"Now" is `Date.now() + offset`, where `offset = serverNowMs − midpoint of the heartbeat
round trip`. Call the heartbeat once at boot before showing any timed screen.
*Reasoning:* cheap tablets often have wrong clocks, and expiry is judged on the tablet.

Look: match the merchant app's Receive screens. Black background, one white rounded
ticket holding the QR, system font, green `#30D158` for paid. QR at least 280 CSS px
with a 4-module quiet zone, error correction M, black on white always. Landscape puts
the QR left and the amount right; portrait stacks them.

### 7.3 Offline

- Overlay a slim "Reconnecting…" banner when `navigator.onLine` is false, the snapshot
  is `fromCache` for over 5 s, or two heartbeats in a row fail.
- Idle keeps showing My QR: it is a static code and still valid. Cache the last idle
  state in `localStorage` so a reload during an outage still shows it.
- A sale QR stays up until its own expiry (the customer's phone talks to the server,
  not to the tablet), then falls back to idle.

### 7.4 Kiosk behaviour

- Screen Wake Lock (`navigator.wakeLock.request('screen')`), re-acquired on
  `visibilitychange`. Where unsupported, show a one-time Setup hint to set the tablet's
  auto-lock to Never.
- Web app manifest with `display: fullscreen` so "Add to Home Screen" opens without
  browser chrome; a Fullscreen button in Setup.
- An error boundary that reloads after 10 s, and reports the message through the next
  heartbeat (`lastError`, 200 chars max).
- Updates: `index.html` is served `no-store`, hashed assets immutable. When the
  heartbeat's `latestBuild` differs from the running build and the screen is idle,
  reload. Also reload daily when idle.
- No service worker in this version. *Reasoning:* a stale cached app on a payment
  screen is worse than a blank screen after a cold start with no internet, and the
  printed My QR covers that case.
- Setup opens with a 2-second press on the shop name: language, scanner on/off, camera
  on/off, scanner test, sound on/off, fullscreen, unlink. The tablet never asks for the
  merchant's PIN or anything else that can move money.
- Optional, small: a short chime on Paid (Web Audio; the confirm tap during pairing
  satisfies the browser's user-gesture rule).

### 7.5 Hosting

`firebase.json`: add a `display` target, `public: display/dist`, SPA rewrite, and
headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`X-Robots-Tag: noindex, nofollow`, `Permissions-Policy: camera=(self)`, `Cache-Control:
no-store` on `/index.html` and long-lived immutable on `/assets/**`. Add a
Content-Security-Policy as `Content-Security-Policy-Report-Only` first; enforce it only
after a full run shows no violations (reCAPTCHA Enterprise, Firestore and Functions
endpoints must be allowed). `.firebaserc`: map target `display` to the new site id.

## 8. Scanning a customer on the tablet

`displayScanCustomer({displayId, secret, saleId, tokenData})` in
`functions/src/counterDisplay/scan.ts`. The tablet sends the id of the sale it is
showing; it never sends an amount.

1. `requireDisplay`.
2. `normaliseScannedToken(tokenData)` (see 9.1). Not token-shaped → `invalid-argument`,
   reason `not_a_zapp_code`.
3. Decrypt and parse as `scanToken.ts` does (`decrypt` from `utils/encryption.ts`;
   payload `{id, customerId, expiresAt}`). Refuse the shop's own code.
4. Outside the transaction, as `createPaymentRequest.ts` does: load the customer;
   `enforcePerTransactionLimit(amount, customer)` (`utils/limits.ts`); read
   `paymentRequestTtlSeconds` from `getRates()`.
5. **One transaction** reads `qrCodes/{saleId}`, `customerTokens/{tokenId}`,
   `paymentRequests/{tokenId}`, then:
   - request already exists → return it (a double read by the scanner is a replay, not
     an error);
   - sale must belong to this merchant, be `active`, and be unexpired. `used` → reason
     `already_paid`; anything else → `no_active_sale`;
   - token must be `active` and unexpired;
   - write the token: `status: 'used'`, `scannedBy: merchantId`, `scannedAt`,
     `scannedVia: 'counter_display'`;
   - create the request, keyed by `tokenId` like `createPaymentRequest`: amount,
     currency and reference **copied from the sale**, `status: 'pending'`, `expiresAt`,
     `source: 'counter_display'`, `displayId`, `saleId`, `customerName`;
   - void the sale: `status: 'expired'`, `cancelledAt`, `supersededBy: requestId`.
6. After commit: push the customer the same message `createPaymentRequest` sends
   (`payment.request` / `payment.request_with_reference` via `sendPushNotification`),
   then `syncCounterState`.

*Reasoning for the single transaction.* `processPayment` only pays a sale whose doc is
`active`, read inside its own transaction. Voiding the sale in the same transaction
that raises the request means exactly one of "customer paid the QR" and "customer was
sent a request" can commit. Without it, one sale could be paid twice.

*Reasoning for skipping `guardPaidReference`.* The sale's reference was already checked
when `generateQRCode` created it, and `approvePaymentRequest` records it on payment.

*Reasoning for sending straight away, with no confirm tap by the cashier.* The cashier
set the amount; the customer still sees shop, amount and note on their own phone and
approves with their PIN. A second tap on the cashier's phone adds a step and no safety.

Type additions in `functions/src/types/index.ts`: `QRCode.supersededBy?`,
`MerchantPaymentRequest.source?`, `.displayId?`, `.saleId?`, `.customerName?`,
`CustomerToken.scannedVia?`. `QRCodeStatus` stays as it is, so merchant apps that
predate this feature still read a voided sale as `expired`.

On the tablet, a scan with no sale showing makes **no server call**: show "Ask the
cashier to enter the amount first" for 4 seconds. *Reasoning:* the customer's code is
single-use and lives two minutes; not sending it keeps it valid for when the sale
appears.

## 9. Scanner input in a browser

### 9.1 What a customer code looks like

`generateCustomerToken` shows `encrypt(payload)`:
`v2:<24 hex>:<32 hex>:<hex…>` (`utils/encryption.ts`, 12-byte nonce, 16-byte tag).

`normaliseScannedToken(raw)`, implemented once on the server and once in
`display/src/scanner/tokenFormat.ts`, tested against one shared fixture file: trim,
drop CR/LF/TAB, lower-case, then match
`^v2[^0-9a-f]([0-9a-f]{24})[^0-9a-f]([0-9a-f]{32})[^0-9a-f]([0-9a-f]{2,})$` and
rebuild with `:`.

*Reasoning:* a USB/Bluetooth scanner "types" through the tablet's keyboard layout. A
non-US layout can turn `:` into another character, and Caps Lock can flip case. The
payload is hex, so both are recoverable. A layout that changes the digits themselves is
not recoverable; the Setup scanner test exists to catch that on day one.

### 9.2 External scanner (keyboard mode)

`hidScanner.ts`, a pure assembler fed by a `keydown` listener on `window`:

- append `event.key` when it is one character; `Enter` or `Tab` ends a scan;
- a gap over 150 ms between keys clears the buffer (people type slower than scanners);
- ignore events whose target is an input, and everything while Setup is open;
- accept only buffers of 60+ characters that normalise; ignore a repeat of the same
  token within 3 seconds.

Setup → **Scanner test** shows the raw characters received and whether they parse.
Compatibility mode (off by default): an off-screen focused
`<input inputmode="none" autocapitalize="off" autocorrect="off" spellcheck="false">`
read on Enter, for Android builds that report `Unidentified` keys.

Put in `COUNTER_DISPLAY.md` for shops: buy a **2D imager** that reads phone screens;
set it to USB-HID or Bluetooth-HID keyboard mode with Enter as suffix; set the tablet's
hardware keyboard layout to English (US).

### 9.3 Tablet camera

`qr-scanner` with the front camera, started only while a sale is showing and stopped
otherwise. A small preview tile on the Sale screen lets the customer aim. Frames never
leave the tablet. Off by default until switched on in Setup (the browser asks for
camera permission then).

## 10. Merchant app changes (`merchant-app/src/`)

Gate everything behind `config/app_client` → `merchant.counterDisplay === true`, with a
hook copied from `hooks/useZaadFloatOn.ts`.

| Change | Where | Reuse |
|---|---|---|
| Settings row "Counter display" | `screens/settings/SettingsScreen.tsx` | `TappableRow` |
| List, rename, unlink; "Online" when `lastSeenAt` is under 150 s old | NEW `screens/settings/CounterDisplaysScreen.tsx` | structure of `DevicesScreen.tsx` |
| Link flow: scan tablet QR or type code → name → PIN → "Now tap Confirm on the tablet" (poll `listMyDisplays` until active, 2 min) | NEW `screens/settings/LinkDisplayScreen.tsx` | `QrScannerView`, `CodeSheet` (`components/QrScannerView.tsx`), `PinInput`, `pinActionErrorKey` (`utils/errors.ts`) |
| Service wrappers | NEW `services/counterDisplay.service.ts` | pattern of `services/devices.service.ts` |
| Routes `CounterDisplays`, `LinkDisplay` | `navigation/AppNavigator.tsx` | |
| Receive, while a sale is showing: the status card says it is also on the counter display when one is online | `screens/qr/GenerateQRScreen.tsx` | |
| Follow a tablet scan: in the `qrCodes` listener, when `status == 'expired'` and `supersededBy` is set, open `Charge` for that request instead of showing "expired" | `screens/qr/GenerateQRScreen.tsx` (listener at the "Live settlement watch" effect) | |
| `Charge` can resume an existing request: new params `requestId`; start in `waiting`, read `amount`, `customerName`, `expiresAt` from the request doc | `screens/scan/ChargeScreen.tsx` | its existing `paymentRequests/{id}` listener and cancel flow |
| Strings in `en`, `so`, `ar` | `i18n/locales/*.json` | flat keys, `json.dumps(indent=2, ensure_ascii=False)` + newline |

Customer app: no changes. It already shows the code and the approval prompt.

## 11. Tests

Functions, Jest with `__tests__/helpers/fakeFirestore.ts` (callables wrapped as
`wrapped({data, auth})`; see `agentFloatZaad.test.ts` for a recent example):

- `counterDisplayPairing.test.ts`: full link; wrong PIN; wrong code then lockout;
  customer account refused; frozen merchant refused; fourth display refused; expired
  pairing; decline; replayed confirm rotates secrets; secrets stored only as hashes.
- `counterDisplayState.test.ts`: mode precedence; no display → no writes; flash kept
  across an unrelated sync; flash dropped by a newer sale; duplicate event does not
  extend a flash; an older derivation does not overwrite a newer one; frozen merchant →
  `unavailable`; state doc never contains `feeCents`, `netCents`, ids or a full name.
- `counterDisplayScan.test.ts`: request copies amount and reference from the sale;
  extra `amount` in the call is ignored; sale voided with `supersededBy`; token used;
  no sale; sale already paid; expired token; shop's own code; replay returns the same
  request; over the customer's limit; revoked display; wrong secret then lockout.
- `counterDisplayGuard.test.ts`: app id pinning; rate limit.
- Shared fixture `counterDisplay/__fixtures__/scannedTokens.json` for the normaliser,
  also loaded by the display's vitest suite.
- Emulator (`*.emulator.test.ts`, pattern of `receiptFlow.emulator.test.ts`):
  `processPayment` and `displayScanCustomer` raced on one sale, 20 rounds, exactly one
  wins each time and the ledger shows at most one payment per sale.
- Rules, emulator: add `@firebase/rules-unit-testing` as a dev dependency;
  unauthenticated `get` of a state doc allowed, `list` denied, writes denied, the other
  three collections fully denied.

Display, vitest: `viewModel` (every row of 7.2, expiry edges, clock offset),
`hidScanner` (fast burst, slow typing rejected, repeat suppressed), `tokenFormat`.

Merchant app: pairing-QR parser unit test; `npx tsc --noEmit`; `npx eslint src`;
`npx jest`.

## 12. Order of work, and what needs the user's say-so

Work on a branch `feat/counter-display` off `main`. Commit only when asked.

1. **Backend, no deploy:** `counterDisplay/` module, types, exports in
   `functions/src/index.ts`, rules, indexes, tests. Gate: `cd functions && npm run
   build && npm test` green, including the existing 911 tests.
2. **Display site:** build against the emulators. Gate: vitest green, every screen seen
   in the browser (section 13).
3. **Merchant app:** screens and the two Receive/Charge changes. Gate: `tsc`, eslint,
   jest clean; simulator check needs the user to sign in to the simulator build.
4. **`COUNTER_DISPLAY.md`:** flow, state doc, threat model table, shop setup guide,
   runbook (unlink a lost tablet, read `lastError`, what "Reconnecting" means).

Then stop and ask. Each of these needs the user's explicit go-ahead:

| Step | Why it needs asking |
|---|---|
| Push the branch (repo is public) | Standing rule: ask before any push from `quickPay*` worktrees |
| Create hosting site, register the web app, App Check key, TTL policies (section 14) | Console work only the user can do |
| `firebase deploy --only firestore:rules,firestore:indexes` (answer **N** to deleting indexes) | Prod change |
| Deploy new functions by name: `startDisplayPairing, pollDisplayPairing, confirmDisplayPairing, linkDisplay, listMyDisplays, renameDisplay, unlinkDisplay, displaySignOut, displayHeartbeat, displayScanCustomer` and the three triggers | Prod change; deploy from the pushed commit, named targets only, never bare `--only functions` |
| Redeploy edited functions: `generateQRCode`, `cancelQRCode`, `generateMerchantSticker`, `processAccountDeletions` | Existing prod functions. None moves money, but name each one |
| `firebase deploy --only hosting:display` | New public site |
| Merchant TestFlight build | Only when asked; use the repo's `release-testflight` skill |
| Set `merchant.counterDisplay: true` in `config/app_client` | Turns the feature on |

Deploy order matters: rules and indexes → functions → hosting → app build → flag.
*Reasoning:* the app must never show a screen whose backend is missing, and the site
must never call functions that do not exist yet.

## 13. Verification

Local, end to end, with emulators (`firebase emulators:start --only
firestore,functions`, App Check debug token, `VITE_APPCHECK_DEBUG=true`):

1. Add a `display` entry to `.claude/launch.json` and open the site with
   `preview_start`. Pairing screen shows a QR and a code.
2. A script `scripts/counter-display-e2e.ts` (Admin SDK + wrapped callables, seeded
   merchant and customer) drives the other side: `linkDisplay` → the browser shows
   "Link this screen to {shop}?" → click Yes → Idle with My QR.
3. `generateQRCode` → Sale screen with the amount within a second.
4. `processPayment` → Paid flash with the receipt number, then Idle.
5. New sale, then a simulated scan. In dev builds only, expose
   `window.__zappSimulateScan(text)` that feeds the assembler key by key; call it with
   a real token from `generateCustomerToken` → Approving → `approvePaymentRequest` →
   Paid.
6. Scan with no sale → "Ask the cashier" and no network call (check with
   `read_network_requests`).
7. `cancelQRCode` → Idle. `unlinkDisplay` → "unlinked", then Pairing.
8. Kill the network → banner; My QR still shown; restore → banner clears.
9. Screenshots at tablet size, landscape and portrait, in `en`, `so`, `ar`.

On real hardware before the flag goes on, with a tester merchant: an iPad (Safari) and
an Android tablet (Chrome), each with one Bluetooth and one USB scanner. Run the six
payment scenarios; leave it on for 8 hours and confirm it never sleeps, and that
`lastSeenAt` kept moving; measure tap→QR and pay→Paid times.

## 14. Console setup the user has to do

1. Hosting → add a site (suggest `zapp-display`; the id must be globally free), then
   `firebase target:apply hosting display <site-id>`.
2. Project settings → add a Web app "Zapp Counter Display"; copy its config into
   `display/.env.local`.
3. App Check → register that web app with a new reCAPTCHA Enterprise key limited to the
   display domain; put the site key in `display/.env.local`.
4. Set the functions param `DISPLAY_WEB_APP_ID` to that web app's id.
5. Firestore → TTL policies on `displayPairings.expireAt` and
   `display_rate_limits.expireAt`.
6. Check whether App Check enforcement is on for Cloud Firestore. Either setting works;
   the display sends App Check tokens.

## 15. Threat model (goes into `COUNTER_DISPLAY.md`)

| Threat | Outcome |
|---|---|
| Stranger links their shop to someone's tablet during pairing | Shop name shown on the tablet; owner declines; no QR before confirm |
| Guessing pairing codes | 8 digits, 5-minute life, PIN required, reserve-first lockout per merchant |
| Stolen `displaySecret` | Can raise a request only for the sale the cashier opened, at the cashier's amount; the customer still approves with their PIN. Cannot read balances or history. Merchant unlinks the tablet |
| Leaked `stateKey` | Read-only view of one counter screen |
| Tablet tries other callables | It has no Auth identity; every other callable refuses |
| Another app's App Check token on display endpoints | App id pinned to the display web app |
| Sale paid by QR and by scan | One transaction; exactly one commits |
| Replayed or photographed customer code | Single-use, two-minute life, marked used in the same transaction |
| Flood of `startDisplayPairing` | App Check, per-IP limit, TTL cleanup |
| Injected text in shop name or note | Rendered as text by React; CSP |
| Frozen or deleted merchant | State becomes `unavailable`; guard refuses; deletion revokes displays |

## 16. Not in this version

Several tills per shop (each phone tied to its own tablet); holding a customer who
scans before an amount exists; a service worker for cold starts with no internet;
receipt printing; a native kiosk wrapper.

## 17. Open items outside this plan

- Merchant build 1.0.1 (21) is archived but not in TestFlight: Apple refused the upload
  until a pending agreement is accepted on the developer account. Re-run only the
  export step afterwards.
- `main` (`24588d9`) is three commits ahead of GitHub and not pushed.

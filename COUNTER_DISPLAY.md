# Counter display

A tablet on the shop counter, facing the customer. It always shows the right QR for
the shop, follows the sale the cashier types on Zapp Pay Merchant, and reads
customers' Zapp codes with a USB/Bluetooth scanner or its own camera. The phone stays
in the cashier's hand.

**It moves no money.** Every payment still goes through `processPayment`,
`payMerchant` or `approvePaymentRequest`, with the customer's PIN on the customer's
own phone. The tablet shows codes and forwards a scanned customer code for the sale
the cashier already opened, at that sale's amount. The design and its reasoning are
in `COUNTER_DISPLAY_PLAN.md`; this doc is how it works and how to run it.

| Part | Where |
|---|---|
| Backend | `functions/src/counterDisplay/` |
| Tablet site | `display/` (Vite + React), hosting target `display` |
| Merchant app | Settings → Counter display (`CounterDisplaysScreen`, `LinkDisplayScreen`); Receive and Charge follow a tablet scan |
| Feature flag | `config/app_client` → `merchant.counterDisplay: true`, optional `merchant.counterDisplayUrl` |

---

## How it works

### Pairing

1. The tablet opens the display site and calls `startDisplayPairing`. It shows a QR
   `{"type":"zapp_display_pair","v":1,"id":"dp_…","code":"12345678"}` and the 8 digits.
   The code lasts 5 minutes; the tablet fetches a new one when it runs out.
2. In Zapp Pay Merchant, **Settings → Counter display → Link a screen**: scan the
   tablet's QR or type the code, name the screen, enter the PIN (`linkDisplay`). The
   display is created as `pending_confirm`.
3. The tablet, polling every 2 s (`pollDisplayPairing`), shows
   **"Link this screen to {shop}?"**. The owner checks the name and taps **Yes**
   (`confirmDisplayPairing`). Only then does the tablet get its credentials and a state
   doc, and only then does it show any QR.

**Why the Yes on the tablet is required:** the pairing code is on a public screen.
Someone nearby could claim it for *their* shop; customers would then pay them. The
confirm step shows the claiming shop's name on the tablet, where the real owner sees
the wrong name and taps No, which deletes the display.

A dropped reply to Yes is safe: a second Yes within the 5 minutes issues fresh
credentials and the first set stops working.

### What the tablet holds

No Firebase Auth identity. Three random values in `localStorage`, issued at confirm:

- `displayId` (`cd_` + 24 hex) names the tablet.
- `displaySecret` (64 hex) goes with every call. The server keeps only its SHA-256.
- `stateKey` (64 hex) is the id of the tablet's state doc.

Every other callable in the backend refuses it, because it is never signed in.

### What the tablet shows

One document per tablet, `counterDisplayStates/{stateKey}`, written only by
`syncCounterState` (`state.ts`), which re-derives it from the source every time:

| Shown | When |
|---|---|
| **My QR**, "Pay to {shop}" | Nothing open. Byte-identical to the shop's sticker (`buildStickerPayload`) |
| **Sale**: amount, note, QR, countdown | The cashier pressed Show QR (`qrCodes`, `active`) |
| **"{Name}, approve $X on your phone"** | A request for this shop is pending (`paymentRequests`, cash-outs excluded) |
| **Paid** + receipt number (8 s) | A `merchant_payment` transaction to this shop |
| **Declined / Expired** (5 s) | The request was declined or ran out |
| "This shop can't take payments right now" | The merchant account is not active |

Who keeps it right:

- `generateQRCode` and `cancelQRCode` sync inline, so the QR appears as the phone gets
  its reply.
- Triggers `counterDisplayOnQrCode`, `counterDisplayOnPaymentRequest`,
  `counterDisplayOnTransaction` cover everything else. The money functions are not
  touched: every payment already writes exactly one `merchant_payment` transaction.
- `displayHeartbeat`, every 60 s from each tablet, re-derives too. Whatever a trigger
  missed is right again within a minute.

The doc never holds fees, net amounts, balances, full names or anyone's id.

The tablet judges expiry on the server's clock (`serverNowMs` from the heartbeat,
corrected for the round trip) and shows no timed screen before the first heartbeat:
cheap tablets keep bad time.

### A customer scans their code at the tablet

`displayScanCustomer({displayId, secret, saleId, tokenData})`. The tablet sends the
id of the sale it is showing and the scanned text. **Never an amount.**

1. Guard (below); the text must be a Zapp customer code (`normaliseScannedToken`).
2. Decrypt the code; refuse the shop's own code; check the customer's per-transaction
   limit against the sale's amount.
3. **One transaction**: the sale must be this shop's, `active` and unexpired; the code
   must be `active` and unexpired. Mark the code used, create a payment request keyed
   by the code's id with the sale's amount, currency and note, and void the sale
   (`status: 'expired'`, `supersededBy: requestId`).
4. Push the customer the usual payment-request message, then sync the tablet.

Voiding the sale in the same transaction is what stops one sale being paid twice:
exactly one of "customer paid the QR" and "customer was sent a request" can commit.
A repeat of the same scan returns the same request.

With no sale showing, the tablet makes **no call** and says "Ask the cashier to enter
the amount first". The customer's code is single-use, so not sending it keeps it valid
for when the sale appears.

On the cashier's phone, Receive sees its QR become `expired` with `supersededBy`, and
moves to Charge, waiting on that request as if the phone had scanned the customer.

---

## Collections

All server-only in `firestore.rules`, except the state doc's `get`.

| Collection | Holds |
|---|---|
| `counterDisplayStates/{stateKey}` | What one tablet shows. `get` by anyone with the id (256-bit, the id is the capability); `list` and writes denied |
| `merchantDisplays/{displayId}` | `merchantId`, `name`, `status` (`pending_confirm`/`active`/`revoked`), `secretSha256`, `stateKey`, `lastSeenAt`, `lastError`, `appBuild`, lockout fields |
| `displayPairings/{pairingId}` | Code, secret hash, `waiting`/`claimed`/`completed`/`declined`, 5-minute `expiresAt`, TTL `expireAt` (+1 day) |
| `display_rate_limits/{key_bucket}` | One-minute counters, TTL `expireAt` |

Indexes: `qrCodes` and `paymentRequests` on `merchantId ASC, status ASC, createdAt DESC`.

## Guards and limits

| Call | Guards |
|---|---|
| Every tablet call (`guard.ts`) | App Check, and the app id must be the display web app (`DISPLAY_WEB_APP_ID`); id and secret shape; 120 calls/min per tablet; secret compared in constant time; 10 wrong secrets lock the tablet for 15 min; tablet must be `active`; merchant account active and a shop type |
| `startDisplayPairing` | 6/min per hashed IP |
| `pollDisplayPairing` | 60/min per pairing |
| `linkDisplay` | Signed in; `merchant` or `agent_merchant`; active; PIN (shared PIN lockout); wrong-code lockout of its own (5 tries, then 60 s doubling to 15 min, reserved before the lookup so a bad code can't lock out cash-in); at most 3 active screens; a typed code that matches more than one waiting tablet is refused ("scan the QR instead") |
| `displayScanCustomer` | As above, plus the one transaction in the scan section |

Account deletion revokes the shop's displays and deletes their state docs.

---

## Threat model

| Threat | Outcome |
|---|---|
| Stranger links their shop to someone's tablet during pairing | The tablet shows their shop name; the owner taps No; no QR before Yes |
| Guessing pairing codes | 8 digits, 5-minute life, the merchant's PIN, a lockout per merchant |
| Stolen `displaySecret` | Can raise a request only for the sale the cashier opened, at the cashier's amount; the customer still approves with their PIN. Can't read balances or history. The merchant unlinks the tablet |
| Leaked `stateKey` | A read-only view of one counter screen |
| Tablet calls other callables | It has no Auth identity; they refuse it |
| Another app's App Check token on display calls | App id pinned to the display web app |
| One sale paid by QR and by scan | One transaction; exactly one commits |
| Replayed or photographed customer code | Single-use, two-minute life, marked used in the same transaction |
| Flood of `startDisplayPairing` | App Check, per-IP limit, TTL cleanup |
| Script in a shop name or note | Rendered as text by React; CSP (report-only until enforced) |
| Frozen or deleted merchant | State becomes "can't take payments"; guard refuses; deletion revokes displays |

---

## Shop setup guide

**What to buy**

- Any tablet with a current browser: iPad (Safari) or Android (Chrome).
- Optional but best: a **2D imager** scanner that reads phone screens, USB or
  Bluetooth. A 1D laser scanner will not read QR codes.

**Scanner settings** (from the scanner's own setup barcodes)

- USB-HID or Bluetooth-HID **keyboard mode**.
- **Enter** as the suffix.
- On the tablet, set the hardware keyboard layout to **English (US)**.

**Set up the tablet**

1. Open the counter display address (shown in Settings → Counter display once
   `counterDisplayUrl` is set).
2. Add it to the home screen (Share → Add to Home Screen on iPad; menu → Add to Home
   screen on Android) and open it from there: it runs full screen.
3. Set the tablet's auto-lock to **Never**, and plug it in. Where the browser can't
   keep the screen on by itself, the display says so.
4. In Zapp Pay Merchant: Settings → Counter display → Link a screen. Scan the tablet,
   name it, enter your PIN, then tap **Yes** on the tablet after checking it shows
   your shop's name.
5. On the tablet, press and hold the shop name for 2 seconds to open **Setup**:
   - Language (or the shop's language).
   - Scanner on, then **Scanner test**: scan a Zapp code from a phone. It must say
     "Reads as a Zapp code". If not, fix the keyboard layout. If some Android tablets
     still fail, turn on **Scanner compatibility mode**.
   - Camera on if there is no scanner (the browser asks for camera permission).
   - Sound when paid.

---

## Runbook

**A tablet is lost or stolen.** Settings → Counter display → Unlink. It stops at once:
its state doc is deleted and every call it makes is refused. Its screen returns to
pairing.

**A tablet shows "Reconnecting…".** The browser is offline, the live connection has
been stale for over 5 seconds, or two heartbeats in a row failed. It keeps showing My
QR, which still works (the customer's phone talks to the server, not the tablet). A
sale QR stays up until its own expiry. It clears by itself when the connection is
back. If it won't, check the shop's Wi-Fi, then reload the page.

**A tablet shows the wrong thing.** Wait a minute: the heartbeat re-derives the state.
If it persists, look at `merchantDisplays/{displayId}`:

- `lastSeenAt` not moving: the tablet isn't reaching the server (Wi-Fi, a sleeping
  tablet, or the page closed).
- `lastError`: the last error the page caught before reloading itself (200 chars).
- `appBuild`: the build it runs. Compare with `config/app_client.display.latestBuild`.

**Shipping a new build.** Deploy hosting, then set `config/app_client.display.latestBuild`
to the new build id. Tablets reload while idle, never mid-sale. They also reload once
a day while idle.

**The merchant app says "Waiting for Yes on the tablet" forever.** The tablet's code
ran out, or nobody tapped Yes. Unlink that entry and link again.

**Scans do nothing.** On the tablet, Setup → Scanner test. No characters: the scanner
isn't in keyboard mode or isn't connected. Characters but "Not a Zapp code": the
keyboard layout changes the digits; set it to English (US).

---

## Local development

The Functions emulator can't run this backend: it wraps `admin.firestore` in a bound
function, which drops its static members (`FieldValue`, `Timestamp`). So:

```
firebase emulators:start --only firestore --project demo-zapp
(cd functions && npm run build)
node scripts/counter-display-host.js        # serves the display callables + triggers on :5001
(cd display && npm run dev -- --mode emulator)   # http://localhost:5175
```

`functions/.secret.local` (git-ignored) holds dev `ENCRYPTION_KEY` and `PIN_PEPPER`.
Drive the phone side, one step per run, with
`functions/src/__tests__/counterDisplay.e2e.emulator.test.ts` (steps in its header:
`seed`, `link`, `sale`, `pay`, `token`, `approve`, `decline`, `cancel`, `unlink`). In
dev builds the page exposes `window.__zappSimulateScan(text)`, which types a code into
the scanner input key by key.

Tests: `cd functions && npm test`; `cd display && npm test`; `cd merchant-app && npx jest`.

---

## Rollout

Status: built and committed on `feat/counter-display`; **nothing deployed**.

Console setup (by hand):

1. Hosting: add a site (suggested `zapp-display`), then
   `firebase target:apply hosting display <site-id>`.
2. Project settings: add a Web app "Zapp Counter Display"; put its config in
   `display/.env.local`.
3. App Check: register that web app with a reCAPTCHA Enterprise key limited to the
   display domain; put the site key in `display/.env.local`.
4. Set the functions param `DISPLAY_WEB_APP_ID` to that web app's id.
5. Firestore TTL policies on `displayPairings.expireAt` and `display_rate_limits.expireAt`.

Deploy in this order, each with explicit go-ahead, from the pushed commit:

1. `firebase deploy --only firestore:rules,firestore:indexes` (answer **N** to deleting
   indexes).
2. New functions by name: `startDisplayPairing, pollDisplayPairing,
   confirmDisplayPairing, linkDisplay, listMyDisplays, renameDisplay, unlinkDisplay,
   displaySignOut, displayHeartbeat, displayScanCustomer, counterDisplayOnQrCode,
   counterDisplayOnPaymentRequest, counterDisplayOnTransaction`.
3. Edited functions by name: `generateQRCode, cancelQRCode, generateMerchantSticker,
   processAccountDeletions`. None moves money.
4. `cd display && npm run build`, then `firebase deploy --only hosting:display`.
5. Merchant app build (TestFlight via the `release-testflight` skill).
6. `config/app_client`: `merchant.counterDisplayUrl`, then `merchant.counterDisplay: true`.

*Why this order:* the app must never show a screen whose backend is missing, and the
site must never call functions that don't exist yet.

Before turning the flag on for everyone, with a tester shop: an iPad and an Android
tablet, each with a Bluetooth and a USB scanner; run QR payment, tablet scan, decline,
expiry, cancel and unlink; leave it on 8 hours and check it never sleeps and
`lastSeenAt` keeps moving; measure tap→QR and pay→Paid. If pay→Paid is over 2 s at
p95, set `minInstances: 1` on the three triggers.

## Known gaps

- One counter per shop: every linked tablet mirrors the shop's newest sale.
- A customer who scans before an amount is typed is asked to wait; they are not held.
- No service worker: with no internet at all, a cold-started tablet shows nothing. The
  printed My QR sticker covers that case.
- The Content-Security-Policy is report-only until a full run shows no violations.
- The Somali and Arabic strings (tablet and merchant app) need a native speaker's check.
- Expiry on a resumed Charge (after a tablet scan) is judged on the phone's own clock.

# Local QA harness

Click through both apps signed in, on the iOS simulator, against local Firebase
emulators. Nothing touches production and no real money exists.

## Start

```bash
scripts/qa/emulators.sh          # auth :9099, firestore :8080, functions :5001, storage :9199, App Check proxy :5002
node scripts/qa/seed-emulator.mts  # wipes the emulators, then seeds (Node 23.6+)
```

- **Project ID.** The emulators run as `quickpay-485417`, because the apps' native config names it and the emulators keep each project's data apart. To keep that safe, `emulators.sh` hides every credential (`XDG_CONFIG_HOME`, `CLOUDSDK_CONFIG`, no `GOOGLE_APPLICATION_CREDENTIALS`). The CLI then reports "not authenticated", and anything the emulators don't cover (FCM, Pub/Sub, RTDB) fails instead of reaching prod.
- **Secrets.** On first run it writes local dummies to `functions/.secret.local` (gitignored).
- **Admin SDK shim.** firebase-tools 15.32's Functions emulator binds `admin.firestore` and drops `Timestamp` and `FieldValue`, so every flow fails. `scripts/qa/functions-emulator-shim.cjs`, preloaded through `NODE_OPTIONS`, restores them in the emulator's workers only.
- **App Check.** Callables enforce it. The emulator decodes tokens without verifying them, but a token must be present. `scripts/qa/appcheck-proxy.mjs` (:5002) adds a placeholder token and forwards to :5001. The apps call :5002 and leave App Check off. The proxy prints one line per call, with name, status and error, which is the quickest way to see what a screen calls.
- **Scheduled functions** don't run (there's no Pub/Sub emulator), so holds and codes don't expire on their own.

## The seed

The seed drives the real callables, so every cent goes through `functions/src/ledger/`, then checks the ledger sums to zero.

It creates:
- **Amina** +252634000001, customer, USD + SLS.
- **Hodan** +252634000002, customer.
- **Hargeisa Coffee House** +252634000003, merchant.
- **Daallo Cash Point** +252634000004, top-up agent with $1,000 and SLS 4,000,000 of float, area Jigjiga Yar.
- **Two admins**, used only to approve the role requests and the float.
- **History:** cash-ins, a QR payment, a till payment, P2P in both currencies, a due bill and a paid bill, an open dispute, and a pending payout.

Every seeded account's PIN is **739146**.

## Point a simulator at it (debug builds only)

```bash
xcrun simctl spawn <udid> defaults write quickpay ZAPP_EMULATOR_HOST 127.0.0.1
xcrun simctl spawn <udid> defaults write com.quickpay.merchant ZAPP_EMULATOR_HOST 127.0.0.1
xcrun simctl spawn <udid> defaults write quickpay RCT_jsLocation localhost:<metro port>
```

- **The switch.** `src/services/emulator.ts` in each app reads `ZAPP_EMULATOR_HOST` from NSUserDefaults, only under `__DEV__`, so a release build can't be pointed at localhost.
- **Turning it off.** Run `defaults delete … ZAPP_EMULATOR_HOST`.
- **Old sign-ins.** The app keeps its keychain across reinstalls, so a production sign-in can survive. Use **Sign Out** on the lock screen first.
- **Signing in.** Phone sign-in works with no reCAPTCHA. The SMS code is at `curl -s http://127.0.0.1:9099/emulator/v1/projects/quickpay-485417/verificationCodes`.
- **No camera on the simulator.** On the emulators, both apps' scanners show **QA · Enter QR payload**. `node scripts/qa/qr.mts sticker | charge <cents> | customer` prints a payload to paste.

## Known emulator quirks (production unaffected)

- **Stale listeners.** The emulator closes the iOS Firestore SDK's stream within a minute or two, and the SDK reopens it only on foreground. In emulator mode the apps cycle Firestore's network every 20 s so listeners stay live. If a screen still looks stale, background the app and reopen it.
- **Fast Refresh drops often.** After an edit, relaunch the app (`simctl terminate` + `launch`). A full JS reload can abort inside Reanimated's `installTurboModule`; relaunch.
- **Warning toasts.** React Native Firebase's deprecation warnings are silenced in emulator mode, because their LogBox toast covered the tab bar.
- **Typing PINs.** Typing into the six-box PIN inputs faster than a person drops digits; type one at a time.

# Zapp listener

A small Android app for the phone that holds Zapp's Zaad (or eDahab)
collection SIM. It forwards the operator's "you received money" texts to
Zapp (`mobileMoneyListener`), signed with this phone's own key, and sends a
heartbeat every minute. Texts are queued on the phone and retried until Zapp
accepts them, so nothing is lost while it's offline. See
`functions/src/mobileMoney/` for the server side.

Not on the Play Store: Google only allows SMS-reading apps that are the
default SMS app. Install it directly (sideload) on the dedicated phone.

## Build

```bash
cd listener-app
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest  # signing and queue tests
```

## Set up a phone

1. Use a cheap Android phone that does nothing else. Put the collection SIM in.
2. Install the APK (`adb install app/build/outputs/apk/debug/app-debug.apk`, or
   copy it over and open it; allow "install unknown apps" for that once).
3. In the Zapp admin console, register the phone (`adminRegisterListener`,
   super admin). It shows a **device ID** (`ld_…`) and a **key** once.
4. Open **Zapp listener** and enter:
   - the endpoint (the default is prod; use the staging URL while testing),
   - the device ID and the key,
   - the operator's sender IDs, comma-separated, exactly as texts show them
     (e.g. `Zaad`). Also add them to `config/collection.{provider}.senderIds`.
5. **Save and start**, allow SMS and notifications, then **Allow running in
   the background** (battery optimisation off).
6. Keep it charged, on Wi-Fi or data, and don't force-stop it. The
   notification "Zapp listener" shows it's running.

## Collecting SMS samples

Before the parser exists, tick **Forward every text**, send a few payments to
the SIM, then **Copy recent texts** and send them to whoever writes the
parser. Untick it afterwards: normally only the operator's texts should leave
the phone.

## Signing

`Listener-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`
under the device key, with `Listener-Device: ld_…`. The key is stored
encrypted under a key in the phone's hardware keystore.

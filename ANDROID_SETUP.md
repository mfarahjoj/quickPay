# Android setup

Hargeisa runs on Android. Until these steps are done, neither app can be put in
a merchant's hands, and every other pilot task is blocked behind that.

Both Gradle projects now exist (`mobile/android`, `merchant-app/android`),
generated from the React Native 0.86 template and wired for Firebase. **Neither
has been built**: this machine has an Android SDK but no Java runtime, so
nothing here has been compiled or run. Expect to fix small things on the first
build.

| App | Android package | RN component | Label |
|---|---|---|---|
| `mobile/` (customer) | `com.quickpay.customer` | `QuickPay` | Zapp Pay |
| `merchant-app/` | `com.quickpay.merchant` | `QuickPayMerchant` | Zapp Pay Merchant |

The customer package is a guess that matches the merchant one. **Change it now
if you want something else** — the merchant iOS bundle is already
`com.quickpay.merchant`, but the customer iOS bundle is the odd single-word
`quickpay`, which is not a valid Android package. An application ID is
permanent once uploaded to Play, so this is worth a minute's thought.

## What only you can do

### 1. Register both Android apps in the Firebase console

Project `quickpay-485417` → Add app → Android, once per package above.
Download each `google-services.json` to:

- `mobile/android/app/google-services.json`
- `merchant-app/android/app/google-services.json`

Both paths are gitignored, like the iOS plists. Without these files the Gradle
build fails at the Google Services plugin with a clear message.

### 2. Create a release keystore per app

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore zapp-customer-release.keystore \
  -alias zapp-customer -keyalg RSA -keysize 2048 -validity 10000
```

Keep the keystore and its passwords outside the repo — losing them means never
being able to update that app again. Then point `release` at it in
`android/app/build.gradle`; today it still uses the debug signing config the
template ships with, which is fine for a local run and not for Play.

### 3. App Check: register the SHA-256 and turn on Play Integrity

`index.js` in both apps already asks for the Play Integrity provider in release
builds and the debug provider in development, and the native dependency is in
`app/build.gradle`. What is missing is the registration:

1. Add the release signing certificate's SHA-256 to the Firebase Android app.
2. Firebase console → App Check → register each Android app with Play Integrity.
3. For a local debug build, run it once, find the debug token in logcat and add
   it under App Check → Manage debug tokens.

Every money callable sets `enforceAppCheck`, so an unregistered build gets
refused on payments rather than failing visibly at startup.

### 4. Play Console

Decide which account publishes: **Gaadhi Hargeisa Ltd** (an organisation
account, D-U-N-S already issued) or a new one. This matters for the pilot
timeline — a newly created *personal* developer account has to run a closed
test with a minimum number of testers for 14 continuous days before it can
publish to production. Organisation accounts are exempt.

For the pilot, use the **internal testing** track: up to 100 testers, available
in minutes rather than days, and it satisfies Play Integrity (a sideloaded APK
generally will not, which would leave App Check failing on exactly the
callables that move money).

Collect each pilot merchant's Google account email when booking their
onboarding visit — internal testing is by email address, and a rep standing in
a shop without it cannot install the app.

## Then

```bash
cd mobile && npx react-native run-android      # or merchant-app
```

First build will download Gradle and the Android toolchain, and needs a JDK 17+
on PATH (`brew install --cask zulu@17` or Android Studio's bundled JDK).

Things worth checking on that first run, because they are the ones a template
scaffold usually gets wrong for this project:

- Camera preview and QR scanning (`react-native-vision-camera`) in both apps.
- Push notifications arriving (FCM), including the runtime
  `POST_NOTIFICATIONS` prompt on Android 13+.
- Biometric unlock on the customer app (`react-native-keychain`,
  `react-native-biometrics`).
- Somali and Arabic rendering, including right-to-left layout in Arabic.

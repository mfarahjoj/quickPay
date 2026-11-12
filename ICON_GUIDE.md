# App icons

Both apps (`mobile/` and `merchant-app/`) use the same icon: the Zapp Pay bolt
(`M13.5 2 4 13.5h6.2L9.8 22 20 10.2h-6.6L13.5 2Z`, 24×24 grid) in white on a coral
`#FF5043` gradient square. It matches the Play listing icons rendered from the
`store-listing/google-play/src` `#icon` frame.

Every icon file is generated from vector source. Don't hand-edit the PNGs.

```bash
cd scripts && npm install && npm run generate
```

Colours, gradient and bolt size live in `scripts/generate-icons.js` (`CORAL`, set per app in `APPS[].palette`).
Change them there and re-run.

## What it writes (per app)

| Platform | Files | Notes |
|---|---|---|
| iOS | `ios/<App>/Images.xcassets/AppIcon.appiconset/Icon-*.png` | 40 → 1024 px, full bleed, RGB with no alpha (App Store rejects alpha) |
| Android 8+ | `res/mipmap-anydpi-v26/ic_launcher{,_round}.xml` | Adaptive icon: `drawable/ic_launcher_background.xml` (gradient) + `ic_launcher_foreground.xml` (bolt), with the foreground reused as the Android 13 themed-icon `monochrome` layer |
| Android 7 | `res/mipmap-*/ic_launcher.png`, `ic_launcher_round.png` | Legacy fallback for API 24–25 (rounded square and circle) |

The 512 Play listing icon is not generated here. `store-listing/google-play` renders it to
`out/<app>/icon-512.png` along with the rest of the listing graphics. The customer
copy at `mobile/android/app/src/main/res/play-store-icon.png` is copied from there
and is not drawn separately. If you change the colours in the generator, re-render the
listing icon too.

Both manifests set `android:icon="@mipmap/ic_launcher"` and
`android:roundIcon="@mipmap/ic_launcher_round"`.

## Checking a change

- iOS: build to the simulator and look at the home screen. If the old icon persists,
  uninstall the app first, because SpringBoard caches icons.
- Android: `./gradlew :app:assembleDebug`, then
  `aapt2 dump badging app/build/outputs/apk/debug/app-debug.apk | grep icon`.

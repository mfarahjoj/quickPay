---
name: release-testflight
description: Archive and upload the Zapp Pay customer app (mobile/) or merchant app (merchant-app/) to TestFlight. Use ONLY when the user explicitly asks to push/upload/deploy to TestFlight — routine changes are verified on the iOS simulator instead.
---

# TestFlight release procedure

**Precondition:** the user explicitly asked for a TestFlight upload. If they didn't, build for the simulator and stop. One-time Apple/signing setup lives in `TESTFLIGHT_QUICKSTART.md`.

App parameters:

| | Customer | Merchant |
|---|---|---|
| Dir | `mobile/ios` | `merchant-app/ios` |
| Workspace | `QuickPay.xcworkspace` | `QuickPayMerchant.xcworkspace` |
| Scheme | `QuickPay` | `QuickPayMerchant` |
| Team | `UFYD4ZUDF9` | `UFYD4ZUDF9` |

## 1. Preflight

- `tsc` clean in the app being shipped.
- Confirm which app and what changed (you'll grep the bundle for it in step 4).
- Read the current build number: `PlistBuddy -c "Print :CFBundleVersion" ios/<App>/Info.plist`.

## 2. Bump the build number

- Increment `CFBundleVersion` in `Info.plist` (bump `CFBundleShortVersionString` only if the user wants a new marketing version).
- Check whether `CURRENT_PROJECT_VERSION` in the `.pbxproj` also carries the build number and keep it aligned with the Info.plist train (the merchant project needed exactly this alignment once).

## 3. Archive — always from scratch

```
rm -rf build/<App>.xcarchive
xcodebuild -workspace <Workspace> -scheme <Scheme> -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/<App>.xcarchive archive -allowProvisioningUpdates
```

The `rm -rf` is not optional: `-exportArchive` happily exports whatever sits at the path, so a failed or skipped archive step silently ships old code if a stale archive survives.

## 4. Verify the archive BEFORE exporting (mandatory)

A stale archive once shipped as "build 17" with none of the new code. Both checks must pass:

1. **Version check** — must equal the number you set in step 2:
   `PlistBuddy -c "Print :ApplicationProperties:CFBundleVersion" build/<App>.xcarchive/Info.plist`
2. **Content check** — the new JS is actually in the bundle:
   `grep -a -c '<distinctive-new-string>' build/<App>.xcarchive/Products/Applications/*.app/main.jsbundle` → must be > 0
   (and grep for a removed string → must be 0, when applicable).

If either fails, stop and re-archive; do not export.

## 5. Export & upload

```
xcodebuild -exportArchive -archivePath build/<App>.xcarchive \
  -exportOptionsPlist ios/ExportOptions.plist -exportPath build/export -allowProvisioningUpdates
```

`ExportOptions.plist` is set to `destination=upload`, so this uploads straight to App Store Connect.

## 6. Confirm the upload actually happened

- The export log must show **`Uploaded <AppName>`**. An `ARCHIVE SUCCEEDED` alone means nothing — the merchant app once archived fine while the export step never ran.
- dSYM warnings for React/Hermes frameworks are normal; ignore them.
- Report the uploaded build number to the user. Processing in App Store Connect takes ~10–30 min before the build appears in TestFlight.

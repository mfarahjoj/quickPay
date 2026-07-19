# iOS TestFlight Deployment Guide

## Prerequisites Checklist

- [ ] Apple Developer Account ($99/year)
- [ ] Mac with Xcode installed
- [ ] Bundle Identifier decided (e.g., `com.yourcompany.quickpay`)
- [ ] Firebase iOS app configured
- [ ] GoogleService-Info.plist downloaded

## Step-by-Step Deployment Process

### 1. Open Xcode Project

```bash
cd ios
open QuickPay.xcworkspace  # Use .xcworkspace, NOT .xcodeproj
```

### 2. Configure Signing & Capabilities

In Xcode:

1. **Select your project** in the left sidebar
2. **Select the QuickPay target**
3. **Go to "Signing & Capabilities" tab**
4. **Check "Automatically manage signing"**
5. **Select your Team** (Apple Developer Account)
6. **Set Bundle Identifier**: `com.yourcompany.quickpay`
7. **Add Capabilities**:
   - Push Notifications (for Firebase Messaging)
   - Background Modes > Remote notifications
   - Camera (for QR scanning)
   - Face ID (for biometric auth)

### 3. Update Info.plist Permissions

Add these permission strings to `ios/QuickPay/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>We need camera access to scan QR codes for payments</string>
<key>NSFaceIDUsageDescription</key>
<string>We use Face ID to securely authenticate your payments</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>We need access to save QR codes to your photo library</string>
```

### 4. Update Build Settings

In Xcode:
1. Select your project > Build Settings
2. Search for "deployment target"
3. Set iOS Deployment Target to **13.0** or higher
4. Set Build Configuration to **Release**

### 5. Archive Your App

1. In Xcode menu: **Product > Destination > Any iOS Device (arm64)**
2. In Xcode menu: **Product > Archive**
3. Wait for the archive process to complete (5-10 minutes)

### 6. Upload to App Store Connect

1. Once archived, the **Organizer** window opens
2. Select your archive
3. Click **Distribute App**
4. Select **App Store Connect**
5. Click **Upload**
6. Select **Automatically manage signing**
7. Click **Upload**
8. Wait for upload to complete (5-15 minutes)

### 7. Configure in App Store Connect

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Click **My Apps** > **+ (New App)**
3. Fill in:
   - **Platform**: iOS
   - **Name**: QuickPay
   - **Primary Language**: English
   - **Bundle ID**: com.yourcompany.quickpay (same as Xcode)
   - **SKU**: quickpay-ios-app
   - **User Access**: Full Access

### 8. Set Up TestFlight

1. Go to your app in App Store Connect
2. Click **TestFlight** tab
3. Under **Builds**, find your uploaded build
4. Click on the build number
5. Fill in **Export Compliance** information (usually "No" for standard apps)
6. Add **Test Information**:
   - Beta App Description
   - Feedback Email
   - What to Test notes

### 9. Add Beta Testers

**Internal Testing** (immediate, up to 100 testers):
1. Go to TestFlight > Internal Testing
2. Click **+** to add internal testers
3. Add testers by email
4. They'll receive invite via email

**External Testing** (requires Apple review, unlimited testers):
1. Go to TestFlight > External Testing
2. Create a new group
3. Add testers by email or public link
4. Submit for review (1-2 days)

### 10. Testers Install App

Testers need to:
1. Install TestFlight app from App Store
2. Accept email invitation
3. Install QuickPay from TestFlight
4. Provide feedback

## Build Script (Optional)

Add to `mobile/package.json`:

```json
"scripts": {
  "ios:build": "react-native bundle --platform ios --dev false --entry-file index.js --bundle-output ios/main.jsbundle",
  "ios:clean": "cd ios && xcodebuild clean && cd ..",
  "pod:install": "cd ios && pod install && cd .."
}
```

## Troubleshooting

### Common Issues

1. **Signing Error**: Make sure your Apple Developer account is valid
2. **Build Failed**: Run `cd ios && pod install` and try again
3. **Firebase Error**: Ensure GoogleService-Info.plist is in ios/QuickPay/
4. **Camera Not Working**: Check Info.plist has camera permission
5. **Upload Failed**: Check your app version/build number is incremented

### Clean Build

If you have issues:

```bash
# Clean everything
cd ios
rm -rf Pods Podfile.lock
rm -rf ~/Library/Developer/Xcode/DerivedData/*
pod deintegrate
pod install
cd ..

# Rebuild in Xcode
```

## Version Increments

For each new TestFlight build:

1. Update `CFBundleShortVersionString` (e.g., 1.0.0 → 1.0.1)
2. Update `CFBundleVersion` (build number, e.g., 1 → 2)

Or in Xcode:
- General tab > Version (1.0.0)
- General tab > Build (increment each upload)

## Next Steps After TestFlight

1. **Gather Feedback**: Monitor TestFlight feedback
2. **Fix Bugs**: Address issues found in testing
3. **Production Release**: Submit for App Store review
4. **Marketing**: Prepare App Store screenshots and description

## Important Notes

- **First upload takes longest** (provisioning profiles, certificates)
- **Subsequent uploads are faster** (5-10 minutes)
- **TestFlight builds expire after 90 days**
- **Always test on real device before uploading**
- **Keep your certificates backed up**

## Resources

- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [React Native iOS Guide](https://reactnative.dev/docs/running-on-device)
- [Firebase iOS Setup](https://firebase.google.com/docs/ios/setup)
- [TestFlight Guide](https://developer.apple.com/testflight/)

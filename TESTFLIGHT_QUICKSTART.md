# 🚀 TestFlight Quick Start Guide

## TL;DR - Fast Track to TestFlight

### Prerequisites (One-time Setup)
```bash
# 1. Apple Developer Account
Sign up at https://developer.apple.com ($99/year)

# 2. Install Xcode
Download from Mac App Store (free)

# 3. Install Command Line Tools
xcode-select --install
```

### Deployment Steps

#### 1. Prepare Your Build (5 minutes)
```bash
cd /Users/mahamedfarah/quickPay/mobile

# Make script executable
chmod +x scripts/prepare-ios-build.sh

# Run preparation script
./scripts/prepare-ios-build.sh
```

#### 2. Add Firebase Config (2 minutes)
1. Download `GoogleService-Info.plist` from [Firebase Console](https://console.firebase.google.com)
2. Drag it into `ios/QuickPay/` folder in Xcode

#### 3. Configure Signing (5 minutes)
```bash
# Open Xcode workspace
cd ios
open QuickPay.xcworkspace
```

In Xcode:
- Select project → QuickPay target
- Go to "Signing & Capabilities"
- Check "Automatically manage signing"
- Select your Apple Developer Team
- Set Bundle ID: `com.yourcompany.quickpay`

#### 4. Archive & Upload (15 minutes)
In Xcode:
1. Menu: **Product → Destination → Any iOS Device**
2. Menu: **Product → Archive**
3. In Organizer: **Distribute App → App Store Connect → Upload**

#### 5. Configure TestFlight (10 minutes)
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Create new app (if first time)
3. Go to TestFlight tab
4. Select your build
5. Add beta testers by email

#### 6. Done! 🎉
Testers receive email invitation and can install from TestFlight app.

---

## Detailed Guide

For step-by-step instructions with screenshots and troubleshooting:
→ See `mobile/ios-build-guide.md`

## Common Issues

### "No Bundle Identifier" Error
**Solution**: Set Bundle ID in Xcode under Signing & Capabilities

### "Provisioning Profile Error"
**Solution**: Make sure "Automatically manage signing" is checked

### "Firebase Not Configured"
**Solution**: Add GoogleService-Info.plist to ios/QuickPay/ folder

### Build Takes Forever
**Solution**: First build takes 10-15 minutes (normal). Subsequent builds are faster.

## Quick Commands

```bash
# Clean build (if having issues)
cd ios
rm -rf Pods Podfile.lock
pod install
cd ..

# Update pods
cd ios && pod update && cd ..

# Check React Native version
npx react-native --version

# Run on simulator (for testing)
npm run ios
```

## Version Management

Before each new TestFlight build:

**Option 1: Update in Xcode**
- General tab → Version: `1.0.0` (user-facing)
- General tab → Build: `1` (increment each upload)

**Option 2: Update manually**
```bash
# Edit ios/QuickPay/Info.plist
# Increment CFBundleShortVersionString: 1.0.0 → 1.0.1
# Increment CFBundleVersion: 1 → 2
```

## Build Times

- **First archive**: 15-20 minutes
- **Subsequent archives**: 5-10 minutes
- **Upload to App Store Connect**: 5-15 minutes
- **Processing in App Store Connect**: 10-30 minutes
- **TestFlight availability**: Immediate for internal, 1-2 days for external (review)

## Automation (Advanced)

For CI/CD deployment, consider:
- **Fastlane**: Automate builds and uploads
- **GitHub Actions**: Automated TestFlight deployment
- **Bitrise**: Mobile CI/CD platform

---

## Need Help?

1. **Detailed guide**: `mobile/ios-build-guide.md`
2. **Apple Support**: https://developer.apple.com/support/
3. **React Native Docs**: https://reactnative.dev/docs/running-on-device
4. **Firebase Setup**: https://rnfirebase.io/

## Checklist Before Upload

- [ ] All TypeScript/ESLint errors fixed (✅ Done!)
- [ ] Firebase configured for iOS
- [ ] Tested on physical device
- [ ] App icons added (1024x1024 required)
- [ ] Bundle ID configured
- [ ] Signing certificates valid
- [ ] Privacy permissions in Info.plist
- [ ] Version/Build number incremented

---

**Estimated Total Time**: 45-60 minutes for first deployment
**Subsequent Deploys**: 15-20 minutes

# 🚀 Quick Setup Instructions

## Your Firebase Config is Ready!

I found your Firebase configuration file at:
```
/Users/mahamedfarah/Downloads/GoogleService-Info (1).plist
```

## Option 1: Automated Setup (Recommended)

Run this single command to set everything up:

```bash
cd /Users/mahamedfarah/quickPay/mobile
./setup-ios.sh
```

This script will:
- ✅ Install all dependencies
- ✅ Create iOS project (if needed)
- ✅ Install CocoaPods
- ✅ Copy Firebase config to correct location
- ✅ Add required permissions to Info.plist

**Time**: ~10-15 minutes (first time)

---

## Option 2: Manual Setup

If you prefer to do it step by step:

### Step 1: Install Dependencies (2 min)
```bash
cd /Users/mahamedfarah/quickPay/mobile
npm install
```

### Step 2: Create iOS Project (5 min)
```bash
npx react-native run-ios
```
This will create the `ios` folder. You can stop it once you see the iOS folder created.

### Step 3: Install CocoaPods (3 min)
```bash
cd ios
pod install
cd ..
```

### Step 4: Copy Firebase Config (1 min)
```bash
# Copy the file to the iOS project
cp "/Users/mahamedfarah/Downloads/GoogleService-Info (1).plist" ios/QuickPay/GoogleService-Info.plist

# Also copy to ios root (backup location)
cp "/Users/mahamedfarah/Downloads/GoogleService-Info (1).plist" ios/GoogleService-Info.plist
```

### Step 5: Add Permissions (2 min)

Add these lines to `ios/QuickPay/Info.plist` before `</dict></plist>`:

```xml
<key>NSCameraUsageDescription</key>
<string>We need camera access to scan QR codes for payments</string>
<key>NSFaceIDUsageDescription</key>
<string>We use Face ID to securely authenticate your payments</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>We need access to save QR codes to your photo library</string>
```

---

## After Setup

### Open in Xcode
```bash
cd ios
open QuickPay.xcworkspace
```

⚠️ **Important**: Always open `.xcworkspace`, NOT `.xcodeproj`

### Configure Signing

In Xcode:
1. Select **QuickPay** project (left sidebar)
2. Select **QuickPay** target
3. Go to **Signing & Capabilities** tab
4. Check ☑️ **Automatically manage signing**
5. Select your **Team** (Apple Developer Account)
6. Set **Bundle Identifier**: `com.yourcompany.quickpay`
   - Replace `yourcompany` with your company name
   - Must be unique across App Store

### Build for Testing

Test on simulator first:
```bash
npm run ios
```

If it builds successfully, you're ready for TestFlight! 🎉

---

## Troubleshooting

### "pod: command not found"
```bash
sudo gem install cocoapods
```

### "No such file or directory: ios/"
Run this to create the iOS project:
```bash
npx react-native run-ios
```

### "GoogleService-Info.plist not found"
Make sure you copied the file:
```bash
ls -la ios/QuickPay/GoogleService-Info.plist
```

Should show the file. If not, copy it manually:
```bash
cp "/Users/mahamedfarah/Downloads/GoogleService-Info (1).plist" ios/QuickPay/GoogleService-Info.plist
```

### Build fails in Xcode
1. Clean build folder: **Product → Clean Build Folder**
2. Close Xcode
3. Run: `cd ios && pod install && cd ..`
4. Reopen Xcode

---

## Next Steps

After setup is complete:

1. **Test locally**: `npm run ios`
2. **Archive for TestFlight**: Follow `TESTFLIGHT_QUICKSTART.md`
3. **Upload to App Store Connect**
4. **Add beta testers**

---

## Quick Reference

```bash
# Run automated setup
./setup-ios.sh

# Test on simulator
npm run ios

# Open in Xcode
cd ios && open QuickPay.xcworkspace

# Clean and reinstall pods
npm run ios:clean

# Update pods
npm run pod:update
```

---

Need more help? Check:
- `TESTFLIGHT_QUICKSTART.md` - Quick deployment guide
- `ios-build-guide.md` - Detailed iOS instructions

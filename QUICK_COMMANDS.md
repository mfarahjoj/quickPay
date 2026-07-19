# Quick Commands for iOS Setup

## From your current location (/Users/mahamedfarah/quickPay)

### Option 1: Automated Setup (Recommended)
```bash
cd mobile
./setup-ios.sh
```

### Option 2: Manual Setup
```bash
# Step 1: Navigate to mobile folder
cd mobile

# Step 2: Create iOS project (this will take 5-10 minutes)
npx react-native run-ios

# Wait for the iOS folder to appear, then you can stop it with Ctrl+C

# Step 3: Install CocoaPods dependencies
cd ios
pod install
cd ..

# Step 4: Copy Firebase config
cp "/Users/mahamedfarah/Downloads/GoogleService-Info (1).plist" ios/QuickPay/GoogleService-Info.plist
```

## Verify Setup

After running the setup, verify:

```bash
# Should show the ios folder
ls -la ios/

# Should show the workspace file
ls -la ios/QuickPay.xcworkspace
```

## Open in Xcode

```bash
cd ios
open QuickPay.xcworkspace
```

## Common Issues

### "command not found: pod"
```bash
sudo gem install cocoapods
```

### "iOS folder still not created"
The iOS folder is created when you run the app for the first time. Let it run until you see:
```
Building...
Launching...
```

### "Build failed"
Make sure you have:
- Xcode installed
- Command Line Tools: `xcode-select --install`
- Accept Xcode license: `sudo xcodebuild -license accept`

## Your Current Location

You are here: `/Users/mahamedfarah/quickPay`
You need to be here: `/Users/mahamedfarah/quickPay/mobile`

So run: `cd mobile` first!

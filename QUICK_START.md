# QuickPay Quick Start Guide

Get up and running with QuickPay in minutes.

## Prerequisites Check

```bash
# Check Node.js version (need 18+)
node --version

# Check npm
npm --version

# Install Firebase CLI
npm install -g firebase-tools

# Check Firebase CLI
firebase --version
```

## 5-Minute Setup

### 1. Firebase Project (5 min)

```bash
# Login to Firebase
firebase login

# Go to https://console.firebase.google.com
# Click "Add project" → Name: "quickpay-hargeisa"
# Enable Google Analytics (optional) → Create project

# In Firebase Console:
# 1. Authentication → Enable "Phone" sign-in
# 2. Firestore → Create database (production mode)
# 3. Upgrade to Blaze plan (for Cloud Functions)
# 4. Storage → Get started
```

### 2. Deploy Backend (2 min)

```bash
cd /Users/mahamedfarah/quickPay

# Select your Firebase project
firebase use --add
# Select: quickpay-hargeisa
# Alias: default

# Deploy everything
firebase deploy
```

### 3. Set Up Mobile App (10 min)

```bash
# Customer App
cd mobile
npm install

# Download Firebase config files from console:
# iOS: Add GoogleService-Info.plist to ios/QuickPay/
# Android: Add google-services.json to android/app/

# iOS setup
cd ios && pod install && cd ..

# Run app
npm run ios    # or npm run android
```

### 4. Test the Flow (5 min)

1. **Register**: Enter +252 phone number
2. **Verify**: Enter OTP code
3. **Setup**: Enter name and 6-digit PIN
4. **View Dashboard**: See $0.00 balance

## Testing QR Payments

### Option 1: Use Two Devices

**Device 1 (Merchant)**:
```bash
cd merchant-app
npm install
cd ios && pod install && cd ..
npm run ios
```

1. Open merchant app
2. Generate QR code for $10
3. Display QR on screen

**Device 2 (Customer)**:
1. Open customer app
2. Tap "Scan & Pay"
3. Scan QR code
4. Enter PIN

### Option 2: Use Firebase Emulators (Development)

```bash
# Install emulators
firebase init emulators
# Select: Authentication, Firestore, Functions

# Start emulators
firebase emulators:start

# In mobile/src/services/firebase.config.ts, uncomment:
# functions().useFunctionsEmulator('http://localhost:5001');
# firestore().useEmulator('localhost', 8080);
```

## Payment Gateway Setup (Later)

### Zaad Service

```bash
# Contact: support@zaad.so
# Request: Merchant API access
# Required: Business license, ID documents

# Once approved, add to Firebase:
firebase functions:config:set \
  zaad.merchant_id="YOUR_ID" \
  zaad.api_key="YOUR_KEY"
```

### eDahab

```bash
# Contact: eDahab merchant services
# Similar process to Zaad

firebase functions:config:set \
  edahab.merchant_id="YOUR_ID" \
  edahab.api_key="YOUR_KEY"
```

### Stripe (International)

```bash
# Sign up: https://stripe.com
# Get keys from Dashboard

firebase functions:config:set \
  stripe.secret_key="sk_test_YOUR_KEY"

# For production:
firebase functions:config:set \
  stripe.secret_key="sk_live_YOUR_KEY"
```

## Common Commands

```bash
# Deploy only functions
firebase deploy --only functions

# Deploy only rules
firebase deploy --only firestore:rules,storage

# View function logs
firebase functions:log

# View Firestore data
# Go to: https://console.firebase.google.com
# → Firestore Database

# Clear mobile app cache
cd mobile
rm -rf node_modules
npm install
cd ios && pod install
```

## Troubleshooting

### "Firebase project not found"
```bash
firebase use --add
# Select your project
```

### "Function deployment failed"
```bash
cd functions
npm install
npm run build
cd ..
firebase deploy --only functions
```

### "Mobile app won't build"
```bash
# iOS
cd mobile/ios
pod deintegrate
pod install
cd ../..

# Android
cd mobile/android
./gradlew clean
cd ../..
```

### "SMS OTP not received"
- Check phone number format: +252XXXXXXXXX
- Verify Firebase Authentication is enabled
- Check Firebase quota (10K free/month)

## Project Structure Quick Reference

```
quickPay/
├── functions/           # Backend (Cloud Functions)
├── mobile/             # Customer app
├── merchant-app/       # Merchant app
├── firestore.rules     # Database security
├── README.md           # Full documentation
├── SETUP_GUIDE.md      # Detailed setup
└── QUICK_START.md      # This file
```

## Key Files to Know

### Backend
- `functions/src/index.ts` - Function exports
- `functions/src/auth/` - Authentication
- `functions/src/qr-payments/` - QR payment system

### Mobile App
- `mobile/src/App.tsx` - Main app
- `mobile/src/navigation/` - Navigation
- `mobile/src/screens/` - UI screens
- `mobile/src/services/` - Firebase integration

### Configuration
- `firebase.json` - Firebase config
- `firestore.rules` - Security rules
- `firestore.indexes.json` - Database indexes

## Next Steps After Setup

1. ✅ Test authentication flow
2. ✅ Test QR payment between two devices
3. ⏳ Get payment gateway credentials
4. ⏳ Test top-up functionality
5. ⏳ Beta test with real users
6. ⏳ Submit to app stores

## Cost Monitoring

Check costs at: https://console.firebase.google.com → Usage and billing

**Free tier limits**:
- 10K phone authentications/month
- 50K Firestore reads/day
- 20K Firestore writes/day
- 2M Cloud Function invocations/month

## Resources

- **Firebase Console**: https://console.firebase.google.com
- **Firebase Docs**: https://firebase.google.com/docs
- **React Native Firebase**: https://rnfirebase.io
- **Full Setup Guide**: See SETUP_GUIDE.md

## Support

For issues:
1. Check `SETUP_GUIDE.md` for detailed instructions
2. View Firebase logs: `firebase functions:log`
3. Check Firestore rules are deployed
4. Verify environment variables are set

## Quick Commands Summary

```bash
# Deploy everything
firebase deploy

# Deploy functions only
firebase deploy --only functions

# View logs
firebase functions:log

# Run mobile app (iOS)
cd mobile && npm run ios

# Run merchant app (iOS)
cd merchant-app && npm run ios

# Start Firebase emulators
firebase emulators:start
```

---

🚀 **You're ready to go!** Start with `firebase deploy` and test the authentication flow.

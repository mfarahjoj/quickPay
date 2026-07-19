# QuickPay Setup Guide

Complete guide to set up and deploy the QuickPay digital wallet system for Hargeisa.

## Prerequisites

Before you begin, ensure you have the following installed:

### Development Environment
- **Node.js** 18+ and npm
- **Git** for version control
- **Firebase CLI**: `npm install -g firebase-tools`

### Mobile Development (for testing)
- **Xcode** (for iOS development - macOS only)
- **Android Studio** (for Android development)
- **CocoaPods** (for iOS): `sudo gem install cocoapods`

## Step 1: Firebase Project Setup

### 1.1 Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add project"
3. Enter project name: "quickpay-hargeisa"
4. Enable Google Analytics (optional but recommended)
5. Create project

### 1.2 Enable Firebase Services

1. **Authentication**:
   - Go to Authentication > Sign-in method
   - Enable "Phone" provider
   - Configure SMS settings for Somalia (+252)

2. **Firestore Database**:
   - Go to Firestore Database
   - Click "Create database"
   - Start in production mode
   - Choose closest region (e.g., europe-west)

3. **Cloud Functions**:
   - Go to Functions
   - Upgrade to Blaze (pay-as-you-go) plan
   - Required for Cloud Functions

4. **Cloud Storage**:
   - Go to Storage
   - Get started with default settings

### 1.3 Add Mobile Apps

1. **iOS App**:
   - Click "Add app" > iOS
   - Bundle ID: `com.quickpay.mobile`
   - Download `GoogleService-Info.plist`

2. **Android App**:
   - Click "Add app" > Android
   - Package name: `com.quickpay.mobile`
   - Download `google-services.json`

3. **Merchant Apps** (repeat for merchant app):
   - iOS Bundle ID: `com.quickpay.merchant`
   - Android Package: `com.quickpay.merchant`

## Step 2: Clone and Configure Project

```bash
# Navigate to project directory
cd /Users/mahamedfarah/quickPay

# Initialize Git (if not already done)
git init
git add .
git commit -m "Initial commit"

# Login to Firebase
firebase login

# Initialize Firebase (already configured)
firebase use --add
# Select your Firebase project
# Enter alias: default
```

## Step 3: Deploy Firebase Configuration

### 3.1 Deploy Firestore Rules and Indexes

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

### 3.2 Deploy Storage Rules

```bash
firebase deploy --only storage
```

## Step 4: Set Up Cloud Functions

### 4.1 Install Dependencies

```bash
cd functions
npm install
```

### 4.2 Configure Environment Variables

Create `.env` file in `functions/` directory:

```bash
# Copy from .env.example
# Update with your actual API keys

# Encryption (generate a 32-character random string)
ENCRYPTION_KEY=your-32-character-key-here

# Zaad Service API (get from Zaad Service)
ZAAD_API_URL=https://api.zaad.com/v1
ZAAD_MERCHANT_ID=your-merchant-id
ZAAD_API_KEY=your-api-key

# eDahab API (get from eDahab)
EDAHAB_API_URL=https://api.edahab.com/v1
EDAHAB_MERCHANT_ID=your-merchant-id
EDAHAB_API_KEY=your-api-key

# Stripe (get from Stripe Dashboard)
STRIPE_SECRET_KEY=sk_test_your-key
STRIPE_WEBHOOK_SECRET=whsec_your-secret
```

Set Firebase environment config:

```bash
firebase functions:config:set \
  encryption.key="your-32-character-key" \
  zaad.api_url="https://api.zaad.com/v1" \
  zaad.merchant_id="your-id" \
  zaad.api_key="your-key" \
  edahab.api_url="https://api.edahab.com/v1" \
  edahab.merchant_id="your-id" \
  edahab.api_key="your-key" \
  stripe.secret_key="sk_test_your-key" \
  stripe.webhook_secret="whsec_your-secret"
```

### 4.3 Build and Deploy Functions

```bash
npm run build
cd ..
firebase deploy --only functions
```

## Step 5: Set Up Customer Mobile App

### 5.1 Install Dependencies

```bash
cd mobile
npm install
```

### 5.2 Configure Firebase

1. **iOS**:
   ```bash
   # Copy GoogleService-Info.plist to ios/
   cp path/to/GoogleService-Info.plist ios/QuickPay/
   
   # Install pods
   cd ios
   pod install
   cd ..
   ```

2. **Android**:
   ```bash
   # Copy google-services.json to android/app/
   cp path/to/google-services.json android/app/
   ```

### 5.3 Run the App

```bash
# iOS
npm run ios

# Android
npm run android
```

## Step 6: Set Up Merchant App

```bash
cd merchant-app
npm install

# Configure Firebase (same as customer app)
# Copy GoogleService-Info.plist and google-services.json

# iOS
cd ios && pod install && cd ..
npm run ios

# Android
npm run android
```

## Step 7: Testing

### 7.1 Test Authentication

1. Launch customer app
2. Enter phone number (+252XXXXXXXXX)
3. Verify OTP code
4. Set up PIN and profile

### 7.2 Test QR Payment

1. Launch merchant app
2. Generate QR code with amount
3. Launch customer app
4. Scan QR code
5. Enter PIN to complete payment

### 7.3 Test with Firebase Emulators (Development)

```bash
# Install emulators
firebase init emulators

# Start emulators
firebase emulators:start

# Update mobile apps to use emulators (uncomment in firebase.config.ts)
```

## Step 8: Payment Gateway Integration

### 8.1 Zaad Service Integration

1. Contact Zaad Service for merchant account
2. Get API credentials (Merchant ID, API Key)
3. Update environment variables
4. Test with small amounts

### 8.2 eDahab Integration

1. Contact eDahab for merchant account
2. Get API credentials
3. Update environment variables
4. Test integration

### 8.3 Stripe Integration

1. Create Stripe account
2. Get API keys from Dashboard
3. Update environment variables
4. Configure webhook endpoints:
   - URL: `https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/stripeWebhook`
5. Test with Stripe test cards

## Step 9: Production Deployment

### 9.1 Prepare for Production

1. **Update environment to production**:
   ```bash
   firebase functions:config:set \
     stripe.secret_key="sk_live_your-production-key"
   ```

2. **Deploy all services**:
   ```bash
   firebase deploy
   ```

3. **Build mobile apps for release**:
   ```bash
   # iOS
   cd mobile/ios
   # Open Xcode, archive and upload to App Store
   
   # Android
   cd mobile/android
   ./gradlew bundleRelease
   # Upload to Google Play Console
   ```

### 9.2 App Store Submission

**iOS (App Store)**:
1. Configure app in App Store Connect
2. Add screenshots, description, keywords
3. Set pricing (Free)
4. Submit for review

**Android (Google Play)**:
1. Create app in Google Play Console
2. Add app details and graphics
3. Complete content rating questionnaire
4. Submit for review

## Step 10: Monitoring and Maintenance

### 10.1 Firebase Console

- Monitor Authentication users
- Check Firestore usage
- View Cloud Functions logs
- Monitor Storage usage

### 10.2 Set Up Alerts

1. Go to Firebase Console > Alerts
2. Configure budget alerts
3. Set up error rate alerts
4. Configure performance monitoring

### 10.3 Analytics

1. Enable Firebase Analytics
2. Track key events:
   - User registration
   - Payments completed
   - Top-up successful
   - QR scans

## Troubleshooting

### Common Issues

**1. Firebase deployment fails**:
```bash
# Check Firebase project
firebase projects:list

# Re-login
firebase logout
firebase login
```

**2. Cloud Functions timeout**:
- Check function logs: `firebase functions:log`
- Increase timeout in function configuration

**3. Mobile app won't build**:
```bash
# Clear caches
rm -rf node_modules
npm install

# iOS
cd ios && pod deintegrate && pod install

# Android
cd android && ./gradlew clean
```

**4. SMS OTP not received**:
- Check Firebase Authentication quota
- Verify phone number format (+252XXXXXXXXX)
- Check SMS provider settings

## Security Checklist

- [ ] Firestore Security Rules deployed
- [ ] Storage Security Rules deployed
- [ ] Environment variables secured
- [ ] API keys not committed to Git
- [ ] Firebase App Check enabled
- [ ] Rate limiting configured
- [ ] Webhook signatures verified
- [ ] SSL certificate for custom domain

## Next Steps

1. Apply for Central Bank of Somaliland e-money license
2. Complete KYC integration
3. Set up customer support system
4. Plan marketing and user acquisition
5. Monitor usage and optimize costs

## Support

For technical support:
- Firebase Support: https://firebase.google.com/support
- QuickPay Documentation: See README.md
- Stripe Support: https://support.stripe.com

## Cost Management

**Expected Monthly Costs** (based on usage):

| Service | Free Tier | Paid Tier (100 users) | Paid Tier (1000 users) |
|---------|-----------|----------------------|------------------------|
| Authentication | 10K verifications | $10-20 | $50-100 |
| Firestore | 50K reads/day | $20-40 | $100-200 |
| Cloud Functions | 2M invocations | $10-20 | $50-100 |
| Storage | 5GB | $5-10 | $20-40 |
| **Total** | **$0** | **$45-90** | **$220-440** |

Monitor costs in Firebase Console > Usage and billing.

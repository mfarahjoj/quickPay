# QuickPay - Digital Wallet Payment System for Hargeisa

A Firebase-powered mobile payment wallet system for Hargeisa, Somaliland, featuring QR-based payments, mobile money integration (Zaad/eDahab), and international payment support.

## Why Firebase?

- **Offline-First**: Essential for Hargeisa's intermittent connectivity
- **SMS Delivery**: Excellent delivery rates to +252 (Somalia) numbers
- **Cost-Effective**: 70% cheaper in year one vs traditional backend
- **Zero DevOps**: No servers to maintain
- **Fast Development**: 8 weeks to production vs 12 weeks

## Project Structure

```
quickPay/
├── functions/          # Cloud Functions (Backend)
├── mobile/            # Customer React Native App
├── merchant-app/      # Merchant React Native App
├── firestore.rules    # Firestore Security Rules
└── firebase.json      # Firebase Configuration
```

## Technology Stack

### Backend
- Firebase Authentication (Phone/SMS OTP)
- Cloud Firestore (NoSQL Database)
- Cloud Functions (TypeScript)
- Firebase Storage
- Firebase Cloud Messaging

### Mobile Apps
- React Native (iOS & Android)
- @react-native-firebase SDK
- React Navigation
- react-native-vision-camera (QR scanning)
- react-native-biometrics

### Payment Integrations
- Zaad Service API
- eDahab API
- Stripe (International payments)

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Firebase CLI: `npm install -g firebase-tools`
- React Native development environment (Xcode for iOS, Android Studio for Android)

### Setup

1. **Firebase Project Setup**
   ```bash
   firebase login
   firebase init
   ```
   Select: Firestore, Functions, Storage

2. **Install Dependencies**
   ```bash
   # Cloud Functions
   cd functions && npm install
   
   # Mobile App
   cd ../mobile && npm install
   
   # Merchant App
   cd ../merchant-app && npm install
   ```

3. **Configure Firebase**
   - Download `google-services.json` for Android
   - Download `GoogleService-Info.plist` for iOS
   - Place in respective mobile app directories

4. **Run Development**
   ```bash
   # Deploy functions
   cd functions && npm run deploy
   
   # Run mobile app
   cd mobile
   npx react-native run-ios
   # or
   npx react-native run-android
   ```

## Core Features

### Phase 1 (Week 1) ✓
- [x] Firebase project setup
- [x] Phone authentication with OTP
- [x] User profile management
- [x] Basic Firestore security rules

### Phase 2 (Week 2)
- [ ] Wallet creation and balance management
- [ ] Transaction processing
- [ ] PIN and biometric authentication
- [ ] Transaction history

### Phase 3 (Weeks 3-4)
- [ ] QR code generation (merchants)
- [ ] QR code scanning (customers)
- [ ] Payment processing
- [ ] Real-time notifications

### Phase 4 (Week 5)
- [ ] Zaad Service integration
- [ ] eDahab integration
- [ ] Stripe integration
- [ ] Top-up functionality

### Phase 5 (Week 6)
- [ ] Merchant dashboard
- [ ] Sales reports
- [ ] Settlement/payout system

### Phase 6 (Weeks 7-8)
- [ ] Security audit
- [ ] Performance optimization
- [ ] Beta testing
- [ ] App store submission

## Firebase Collections

- `/users/{userId}` - User profiles and authentication data
- `/wallets/{userId}` - Wallet balances
- `/transactions/{transactionId}` - All financial transactions
- `/qrCodes/{qrCodeId}` - QR payment sessions
- `/topups/{topupId}` - Top-up requests
- `/settlements/{settlementId}` - Merchant payouts
- `/merchantProfiles/{userId}` - Merchant-specific data

## Security

- Firestore Security Rules for data access control
- Firebase App Check for API abuse prevention
- PIN hashing with bcrypt
- Biometric authentication for transactions
- HTTPS-only Cloud Functions
- Webhook signature verification
- Transaction limits based on KYC status

## Cost Estimates

**Year One**: $800-2,000
- Months 1-4: Free tier
- Months 5-12: $100-250/month

**Savings vs Traditional Stack**: $3,760-6,120/year

## Compliance

- Central Bank of Somaliland e-money licensing
- KYC/AML measures
- Transaction limits for unverified accounts
- Data protection and privacy compliance

## Support

For issues and questions, please contact the development team.

## License

Proprietary - All rights reserved

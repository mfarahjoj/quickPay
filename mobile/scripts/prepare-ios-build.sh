#!/bin/bash

# QuickPay iOS Build Preparation Script
# This script helps prepare your iOS app for TestFlight deployment

set -e

echo "🚀 QuickPay iOS Build Preparation"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the mobile directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Must run from mobile directory${NC}"
    exit 1
fi

echo "📦 Step 1: Installing npm dependencies..."
npm install

echo ""
echo "🍎 Step 2: Checking iOS setup..."

if [ ! -d "ios" ]; then
    echo -e "${YELLOW}⚠️  iOS folder not found. Creating iOS project...${NC}"
    npx react-native run-ios --simulator="iPhone 15" || true
fi

echo ""
echo "📱 Step 3: Installing CocoaPods dependencies..."
cd ios
pod install
cd ..

echo ""
echo -e "${GREEN}✅ iOS build preparation complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Add GoogleService-Info.plist to ios/QuickPay/"
echo "2. Open ios/QuickPay.xcworkspace in Xcode"
echo "3. Configure signing in Xcode (Signing & Capabilities)"
echo "4. Set your Bundle Identifier"
echo "5. Archive and upload to TestFlight"
echo ""
echo "📖 See ios-build-guide.md for detailed instructions"

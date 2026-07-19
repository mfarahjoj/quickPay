#!/bin/bash
# QuickPay Merchant iOS build preparation for TestFlight

set -e

echo "QuickPay Merchant — iOS build preparation"
echo "========================================="

if [ ! -f "package.json" ]; then
  echo "Error: run from merchant-app directory"
  exit 1
fi

echo "Installing npm dependencies..."
npm install --legacy-peer-deps

echo "Installing CocoaPods (native arm64)..."
export LANG=en_US.UTF-8
cd ios
env /usr/bin/arch -arm64 /bin/bash -lc \
  'RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 pod install --repo-update'
cd ..

echo ""
echo "Ready to archive. Next steps:"
echo "  1. open ios/QuickPayMerchant.xcworkspace"
echo "  2. Product → Destination → Any iOS Device"
echo "  3. Product → Archive"
echo "  4. Distribute App → App Store Connect → Upload"

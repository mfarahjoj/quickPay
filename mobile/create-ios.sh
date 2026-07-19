#!/bin/bash

# Script to generate iOS native code for existing React Native project

set -e

echo "🚀 Creating iOS native code for QuickPay"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Step 1: Create temp project with same RN version
echo -e "${BLUE}📦 Step 1: Creating temporary React Native project...${NC}"
cd ..
npx react-native@0.73.11 init QuickPayTemp --version 0.73.11 --skip-install

# Step 2: Copy iOS folder
echo ""
echo -e "${BLUE}📱 Step 2: Copying iOS native code...${NC}"
cp -R QuickPayTemp/ios mobile/

# Step 3: Update project name in iOS files
echo ""
echo -e "${BLUE}🔧 Step 3: Updating project configuration...${NC}"
cd mobile/ios

# Update scheme name
if [ -f "QuickPayTemp.xcodeproj/xcshareddata/xcschemes/QuickPayTemp.xcscheme" ]; then
    mv QuickPayTemp.xcodeproj QuickPay.xcodeproj || true
fi

# Rename app folder
if [ -d "QuickPayTemp" ]; then
    mv QuickPayTemp QuickPay
fi

# Update Info.plist if needed
find . -type f -name "*.pbxproj" -exec sed -i '' 's/QuickPayTemp/QuickPay/g' {} +
find . -type f -name "*.plist" -exec sed -i '' 's/QuickPayTemp/QuickPay/g' {} +
find . -type f -name "*.xcscheme" -exec sed -i '' 's/QuickPayTemp/QuickPay/g' {} +

cd ../..

# Step 4: Clean up temp project
echo ""
echo -e "${BLUE}🧹 Step 4: Cleaning up...${NC}"
rm -rf QuickPayTemp

# Step 5: Install pods
echo ""
echo -e "${BLUE}🍎 Step 5: Installing CocoaPods dependencies...${NC}"
cd mobile/ios
pod install
cd ../..

echo ""
echo -e "${GREEN}✅ iOS native code created successfully!${NC}"
echo ""
echo "Next steps:"
echo "1. cd mobile"
echo "2. Copy Firebase config: cp '/Users/mahamedfarah/Downloads/GoogleService-Info (1).plist' ios/QuickPay/GoogleService-Info.plist"
echo "3. Open Xcode: cd ios && open QuickPay.xcworkspace"

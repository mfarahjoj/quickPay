#!/bin/bash

# QuickPay iOS Setup Script
# This script initializes the iOS project and configures Firebase

set -e

echo "🚀 QuickPay iOS Setup"
echo "====================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the mobile directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Must run from mobile directory${NC}"
    exit 1
fi

# Step 1: Install dependencies
echo -e "${BLUE}📦 Step 1: Installing dependencies...${NC}"
npm install

# Step 2: Create iOS project if it doesn't exist
if [ ! -d "ios" ]; then
    echo -e "${YELLOW}⚠️  iOS folder not found. Creating iOS project...${NC}"
    echo ""
    echo "This will take a few minutes..."
    
    # Try running on simulator to generate iOS files
    npx react-native run-ios --simulator="iPhone 15 Pro" &
    RN_PID=$!
    
    # Wait for iOS folder to be created (max 60 seconds)
    COUNTER=0
    while [ ! -d "ios" ] && [ $COUNTER -lt 60 ]; do
        sleep 2
        COUNTER=$((COUNTER + 2))
        echo -n "."
    done
    echo ""
    
    # Kill the React Native process
    kill $RN_PID 2>/dev/null || true
    pkill -f "react-native" 2>/dev/null || true
    
    if [ -d "ios" ]; then
        echo -e "${GREEN}✅ iOS project created successfully${NC}"
    else
        echo -e "${RED}❌ Failed to create iOS project${NC}"
        echo "Please run manually: npx react-native run-ios"
        exit 1
    fi
else
    echo -e "${GREEN}✅ iOS folder found${NC}"
fi

# Step 3: Install CocoaPods dependencies
echo ""
echo -e "${BLUE}🍎 Step 2: Installing CocoaPods dependencies...${NC}"
cd ios

# Check if CocoaPods is installed
if ! command -v pod &> /dev/null; then
    echo -e "${YELLOW}⚠️  CocoaPods not found. Installing...${NC}"
    sudo gem install cocoapods
fi

# Install pods
pod install

cd ..

# Step 4: Copy Firebase config
echo ""
echo -e "${BLUE}🔥 Step 3: Setting up Firebase configuration...${NC}"

FIREBASE_SOURCE="/Users/mahamedfarah/Downloads/GoogleService-Info (1).plist"
FIREBASE_DEST="ios/QuickPay/GoogleService-Info.plist"

if [ -f "$FIREBASE_SOURCE" ]; then
    # Create directory if it doesn't exist
    mkdir -p "ios/QuickPay"
    
    # Copy and rename the file
    cp "$FIREBASE_SOURCE" "$FIREBASE_DEST"
    echo -e "${GREEN}✅ Firebase config copied to $FIREBASE_DEST${NC}"
    
    # Also copy to root of ios folder (some setups need it here too)
    cp "$FIREBASE_SOURCE" "ios/GoogleService-Info.plist"
    echo -e "${GREEN}✅ Firebase config also copied to ios/GoogleService-Info.plist${NC}"
else
    echo -e "${YELLOW}⚠️  Firebase config not found at: $FIREBASE_SOURCE${NC}"
    echo "Please download GoogleService-Info.plist from Firebase Console"
    echo "and place it at: ios/QuickPay/GoogleService-Info.plist"
fi

# Step 5: Update Info.plist with required permissions
echo ""
echo -e "${BLUE}📝 Step 4: Adding required permissions to Info.plist...${NC}"

INFO_PLIST="ios/QuickPay/Info.plist"

if [ -f "$INFO_PLIST" ]; then
    # Check if permissions already exist
    if ! grep -q "NSCameraUsageDescription" "$INFO_PLIST"; then
        # Backup original
        cp "$INFO_PLIST" "$INFO_PLIST.backup"
        
        # Add permissions before closing </dict></plist>
        perl -i -pe 's|</dict>\s*</plist>|<key>NSCameraUsageDescription</key>\n\t<string>We need camera access to scan QR codes for payments</string>\n\t<key>NSFaceIDUsageDescription</key>\n\t<string>We use Face ID to securely authenticate your payments</string>\n\t<key>NSPhotoLibraryUsageDescription</key>\n\t<string>We need access to save QR codes to your photo library</string>\n</dict>\n</plist>|' "$INFO_PLIST"
        
        echo -e "${GREEN}✅ Permissions added to Info.plist${NC}"
    else
        echo -e "${GREEN}✅ Permissions already exist in Info.plist${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Info.plist not found at: $INFO_PLIST${NC}"
fi

echo ""
echo -e "${GREEN}🎉 iOS Setup Complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Open Xcode: cd ios && open QuickPay.xcworkspace"
echo "2. Configure Signing & Capabilities:"
echo "   - Select your Apple Developer Team"
echo "   - Set Bundle Identifier (e.g., com.yourcompany.quickpay)"
echo "3. Archive and upload to TestFlight"
echo ""
echo "📖 See TESTFLIGHT_QUICKSTART.md for detailed instructions"

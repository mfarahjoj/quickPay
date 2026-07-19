#!/bin/bash

# Fix CocoaPods Encoding Issues and Install
echo "🔧 Fixing CocoaPods Setup"
echo "========================"

# Set encoding
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Add to shell profile if not already there
if [ -f ~/.zshrc ]; then
    if ! grep -q "export LANG=en_US.UTF-8" ~/.zshrc; then
        echo "" >> ~/.zshrc
        echo "# Fix CocoaPods encoding" >> ~/.zshrc
        echo "export LANG=en_US.UTF-8" >> ~/.zshrc
        echo "export LC_ALL=en_US.UTF-8" >> ~/.zshrc
        echo "✅ Added encoding fix to ~/.zshrc"
    fi
fi

# Navigate to iOS directory
cd "$(dirname "$0")/ios"

echo ""
echo "📦 Installing CocoaPods dependencies..."
echo "This may take 5-10 minutes on first install"
echo ""

# Run pod install with encoding set
/usr/bin/env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ CocoaPods installation complete!"
    echo ""
    echo "Next steps:"
    echo "1. Copy Firebase config:"
    echo "   cp '/Users/mahamedfarah/Downloads/GoogleService-Info (1).plist' ios/QuickPay/GoogleService-Info.plist"
    echo ""
    echo "2. Open in Xcode:"
    echo "   cd ios && open QuickPay.xcworkspace"
else
    echo ""
    echo "❌ Pod install failed. Please run manually:"
    echo "   cd /Users/mahamedfarah/quickPay/mobile/ios"
    echo "   pod install"
fi

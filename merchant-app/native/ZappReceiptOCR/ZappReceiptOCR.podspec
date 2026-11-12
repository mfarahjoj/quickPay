# On-device receipt text recognition for the merchant app, built on Apple's
# Vision framework. Lives in the repo as a local pod so it needs no third-party
# dependency, adds nothing to the download size, and links without touching
# the Xcode project file.

Pod::Spec.new do |s|
  s.name         = "ZappReceiptOCR"
  s.version      = "1.0.0"
  s.summary      = "Reads the text off a photographed receipt with Apple Vision."
  s.homepage     = "https://github.com/mfarahjoj/quickPay"
  s.license      = { :type => "Proprietary" }
  s.authors      = { "Zapp Pay" => "support@zapppay.app" }
  s.platforms    = { :ios => "15.1" }
  s.source       = { :path => "." }

  s.source_files = "ios/**/*.{h,m}"
  s.requires_arc = true
  s.frameworks   = "Vision", "UIKit", "ImageIO"

  s.dependency "React-Core"
end

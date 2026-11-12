#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#import <Firebase.h>
#import <RNFBAppCheck/RNFBAppCheckModule.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // Must run before [FIRApp configure]: it installs React Native Firebase's
  // App Check provider factory. Without it the native SDK silently uses its
  // default DeviceCheck provider and ignores the provider configured in
  // App.tsx — so the debug token never applies (simulator builds send a
  // placeholder token that every enforced callable rejects) and release
  // builds never use App Attest.
  [RNFBAppCheckModule sharedInstance];
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }

  self.moduleName = @"QuickPayMerchant";
  self.dependencyProvider = [RCTAppDependencyProvider new];
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

// Handle URL scheme callbacks (required for Firebase phone auth reCAPTCHA flow)
- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  return [RCTLinkingManager application:application openURL:url options:options];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

// The app-switcher snapshot is taken as the app goes inactive. Cover the
// window first so it never shows a PIN, a code or a balance (review B6, E14).
static const NSInteger kPrivacyCoverTag = 0x5A505031;

- (void)applicationWillResignActive:(UIApplication *)application
{
  if (self.window == nil || [self.window viewWithTag:kPrivacyCoverTag] != nil) {
    return;
  }
  UIVisualEffectView *cover =
      [[UIVisualEffectView alloc] initWithEffect:[UIBlurEffect effectWithStyle:UIBlurEffectStyleDark]];
  cover.frame = self.window.bounds;
  cover.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  cover.tag = kPrivacyCoverTag;
  [self.window addSubview:cover];
}

- (void)applicationDidBecomeActive:(UIApplication *)application
{
  [[self.window viewWithTag:kPrivacyCoverTag] removeFromSuperview];
}

@end

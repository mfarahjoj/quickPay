# Arabic / RTL in the apps

How Arabic (right-to-left) works in the customer app (`mobile/`) and the merchant app (`merchant-app/`), what was
fixed on 2026-11-23, and what is still open. Read this before touching text alignment, `I18nManager` or a language picker.

## How it works

**Layout direction.** Picking Arabic calls `applyLanguage` (`*/src/i18n/index.ts`), which calls
`I18nManager.allowRTL/forceRTL`. React Native applies that **on the next launch only**: `I18nManager.isRTL` is read
once when the app starts. Neither app can restart itself. In release builds `DevSettings.reload` does nothing, and
there's no restart library. So:
- `applyLanguage` returns `true` once per switch away from the direction the app launched in. Callers then show
  `showRestartNotice()`, which alerts `language.changedTitle` + `language.reopenForLayout` in the *new* language.
  Callers: both `LanguageSelector`s, merchant `WelcomeScreen`, and both `LanguageSync`s (e.g. signing in to a
  profile whose language reads the other way). Customer `EditProfileScreen` puts `language.reopenForLayout` in its own
  success alert instead.
- `applyLanguage` always writes the direction, even when it matches the launch direction. Without that, switching
  ar → en → ar in one session left the next launch left-to-right with Arabic text.
- The persisted flags are in the app's own preferences: `RCTI18nUtil_forceRTL` and `RCTI18nUtil_allowRTL` in the
  app container's `Library/Preferences/<bundle id>.plist`.

**Text alignment.** On iOS, a `<Text>` with no `textAlign` is drawn with `NSTextAlignmentNatural`. UIKit resolves
that from the app bundle's localization, not from `forceRTL`, and both bundles only ship `en`. So Arabic headings and
paragraphs stayed on the left even though flex rows mirrored. React Native does flip an explicit `textAlign: 'left'`
to the right edge when the layout is RTL, on both iOS and Android. So `'left'` effectively means "start".
`*/src/i18n/directionalText.tsx`, imported first in each `index.js`, gives every outermost `<Text>` that default by
swapping the `Text` getter on the `react-native` module object.

## Rules for new code

- Leave `textAlign` unset for normal text: it starts at the reading edge in both directions.
- `textAlign: 'right'` means "end". It lands on the **left** in Arabic. Use `'center'` when you mean centre.
- Content that must stay LTR (API keys, codes): set `writingDirection: 'ltr'`. Such text keeps natural alignment,
  e.g. `merchant-app/src/screens/settings/DevelopersScreen.tsx`. Phone numbers and amounts already keep their digit
  order; only alignment moves.
- Nested `<Text>` takes the outer `<Text>`'s alignment, so set it on the outer one.
- Not covered by the default: `TextInput`, and Reanimated `Animated.Text` (it captured `Text` before the swap; only
  used for counters).
- Arrow and chevron icons: flip them with `transform: [{ scaleX: -1 }]` when `I18nManager.isRTL`
  (see `components/icons/AuthIcons.tsx`, `LineIcons.tsx` `flipInRtl`). Text glyphs like `‹` don't flip.
- Every new string goes in `en`, `so` and `ar` (see CLAUDE.md).

## Checking it on the iOS simulator

1. Start a Metro per app on its own port, from the checkout you're testing:
   `cd mobile && npx react-native start --port 8111` and `cd merchant-app && npx react-native start --port 8112`.
2. Point each app at its Metro. The customer debug build ignores `RCT_METRO_PORT`:
   `xcrun simctl spawn <device> defaults write quickpay RCT_jsLocation localhost:8111` and
   `xcrun simctl spawn <device> defaults write com.quickpay.merchant RCT_jsLocation localhost:8112`.
   If an app still loads someone else's bundle (a red "Unable to resolve … from <other checkout>" screen), relaunch it.
3. You can check everything here without an account: customer onboarding (language flag, top corner) → Log in;
   merchant Welcome (`EN ›` chip) → Get started.
4. Pick Arabic, confirm the reopen notice, then `xcrun simctl terminate`/`launch` the app and check that headings
   and paragraphs start at the right edge. Pick English and relaunch to check LTR comes back.

## Status (2026-11-23)

- Text alignment and the reopen notice were checked on the simulator in Arabic and English in both apps. That run
  used the same code on `fix/app-walkthrough`, which is based on `release/zapp-91`. On this branch (`fix/app-audit`)
  the change type-checks (`npx tsc --noEmit`, both apps) but hasn't been run on a simulator yet.
- Not done, roughly in priority order:
  1. Merchant `screens/auth/LoginScreen.tsx` hardcodes "What's your number?" and its subtitle in English, and its
     back chevron is a text `‹` that doesn't mirror.
  2. `TextInput`s still align left in Arabic (e.g. the name fields in customer `EditProfileScreen`).
  3. On a phone set to Arabic, the customer app's first launch picks Arabic from the device but lays out LTR, with
     no notice. It flips on the second launch.
  4. A real in-app restart instead of the notice needs a small native module per app (it calls
     `RCTTriggerReloadCommandListeners`) and therefore a new build. Decide before adding it.

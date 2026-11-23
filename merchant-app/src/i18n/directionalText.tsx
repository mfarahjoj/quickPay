/**
 * Start-aligned <Text> in both layout directions. Import once, before App.
 *
 * Why: under I18nManager.forceRTL, flex rows mirror but a <Text> with no
 * textAlign does not. On iOS RN draws it with NSTextAlignmentNatural, which
 * UIKit resolves from the app bundle's localization (the bundle only ships
 * `en`), not from forceRTL, so Arabic headings and paragraphs stayed
 * left-aligned. RN flips an explicit textAlign: 'left' to the right edge when
 * the layout is RTL (iOS and Android), so 'left' is RN's "start". This gives
 * every outermost <Text> that default.
 *
 * Opting out, per <Text>:
 * - set textAlign yourself ('center' etc.; note 'right' means "end" and
 *   becomes the left edge in Arabic);
 * - or pin writingDirection (e.g. 'ltr' on API keys): the text keeps its
 *   natural alignment and no default is added.
 * Nested <Text> is passed through untouched: alignment is a paragraph
 * property and the outer <Text>'s value has to win.
 *
 * It works by swapping the `Text` getter on the react-native module object,
 * which every `import { Text } from 'react-native'` reads at render time.
 * Modules that captured Text before this file ran (Reanimated's Animated.Text)
 * keep the stock component.
 */
import React, { useContext } from 'react';
import { StyleSheet } from 'react-native';
import type { TextProps } from 'react-native';

// The live module object: `import * as` would give a copy, and redefining a
// property on the copy changes nothing for other modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactNative = require('react-native');

const BaseText: React.ComponentType<TextProps> = ReactNative.Text;
const TextAncestorContext: React.Context<boolean> | undefined = ReactNative.unstable_TextAncestorContext;

const START_ALIGNED = { textAlign: 'left' } as const;

function DirectionalText(props: TextProps) {
  // Only installed when the context exists (see the guard below).
  const isNested = useContext(TextAncestorContext as React.Context<boolean>);
  if (isNested) {
    return <BaseText {...props} />;
  }
  const flat = StyleSheet.flatten(props.style);
  const alignmentChosen = flat?.textAlign != null && flat.textAlign !== 'auto';
  const directionPinned = flat?.writingDirection != null && flat.writingDirection !== 'auto';
  if (alignmentChosen || directionPinned) {
    return <BaseText {...props} />;
  }
  return <BaseText {...props} style={[START_ALIGNED, props.style]} />;
}
DirectionalText.displayName = 'Text';

const descriptor = Object.getOwnPropertyDescriptor(ReactNative, 'Text');
if (TextAncestorContext && descriptor?.configurable) {
  Object.defineProperty(ReactNative, 'Text', {
    configurable: true,
    enumerable: true,
    get: () => DirectionalText,
  });
} else if (__DEV__) {
  // A React Native upgrade changed how Text is exported. Arabic text will be
  // left-aligned on iOS again until this is updated.
  console.warn('directionalText: could not install the RTL-aware Text default');
}

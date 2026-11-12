import React, { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { wallpaper } from '../theme';

/**
 * The coral wallpaper of the light Home header and the Paid screen: brand
 * coral into raspberry, with a warm glow top right, a coral glow on the left
 * and a plum shade bottom right. It fills its parent, behind the content.
 */
export function Wallpaper({ style }: { style?: StyleProp<ViewStyle> }) {
  // Gradient ids are unique per wallpaper: Home and Paid can both be mounted.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <LinearGradient
        colors={wallpaper.colors}
        start={{ x: 0.37, y: 0 }}
        end={{ x: 0.63, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id={`${id}warm`} cx="0.88" cy="0.07" rx="0.4" ry="0.33" fx="0.88" fy="0.07">
            <Stop offset="0" stopColor="#FFAA78" stopOpacity="0.8" />
            <Stop offset="1" stopColor="#FFAA78" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`${id}coral`} cx="0" cy="0.58" rx="0.62" ry="0.5" fx="0" fy="0.58">
            <Stop offset="0" stopColor="#FF6040" stopOpacity="0.6" />
            <Stop offset="1" stopColor="#FF6040" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`${id}plum`} cx="1" cy="0.9" rx="0.72" ry="0.55" fx="1" fy="0.9">
            <Stop offset="0" stopColor="#6E1240" stopOpacity="0.6" />
            <Stop offset="1" stopColor="#6E1240" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}warm)`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}coral)`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id}plum)`} />
      </Svg>
    </View>
  );
}

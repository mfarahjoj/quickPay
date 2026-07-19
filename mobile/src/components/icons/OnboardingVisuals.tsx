import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Rect,
  Path,
  Circle,
  G,
} from 'react-native-svg';
import { colors } from '../../theme';

/** Slow vertical float used to give hero visuals a weightless, premium feel. */
function FloatWrap({ children, range = 10 }: { children: React.ReactNode; range?: number }) {
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -range] });

  return <Animated.View style={{ transform: [{ translateY }] }}>{children}</Animated.View>;
}

function Glow({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="visualGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={colors.primary} stopOpacity={0.34} />
          <Stop offset="60%" stopColor={colors.primary} stopOpacity={0.10} />
          <Stop offset="100%" stopColor={colors.primary} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill="url(#visualGlow)" />
    </Svg>
  );
}

/** Floating payment card with a ghost card behind it */
export function HeroCardVisual({ size = 260 }: { size?: number }) {
  return (
    <View style={[styles.wrap, { width: size + 80, height: size + 40 }]}>
      <Glow size={size + 80} />
      <FloatWrap>
        <Svg width={size} height={size * 0.78} viewBox="0 0 260 200">
          <Defs>
            <LinearGradient id="cardFace" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#FF5043" />
              <Stop offset="60%" stopColor="#FF7B6B" />
              <Stop offset="100%" stopColor="#7B9DFF" />
            </LinearGradient>
            <LinearGradient id="cardGhost" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.10} />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.03} />
            </LinearGradient>
          </Defs>
          {/* ghost card behind */}
          <G transform="rotate(-8 130 110)">
            <Rect x="40" y="40" width="200" height="124" rx="16" fill="url(#cardGhost)" />
          </G>
          {/* main card */}
          <G transform="rotate(4 130 100)">
            <Rect x="20" y="28" width="208" height="130" rx="16" fill="url(#cardFace)" />
            {/* chip */}
            <Rect x="40" y="52" width="30" height="22" rx="5" fill="#FFFFFF" opacity={0.9} />
            {/* contactless arcs */}
            <Path
              d="M196 56a18 18 0 010 26M204 48a30 30 0 010 42"
              stroke="#FFFFFF"
              strokeOpacity={0.85}
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
            />
            {/* number dots */}
            <Circle cx="46" cy="116" r="3.4" fill="#FFFFFF" opacity={0.9} />
            <Circle cx="58" cy="116" r="3.4" fill="#FFFFFF" opacity={0.9} />
            <Circle cx="70" cy="116" r="3.4" fill="#FFFFFF" opacity={0.9} />
            <Circle cx="82" cy="116" r="3.4" fill="#FFFFFF" opacity={0.9} />
            <Rect x="40" y="132" width="64" height="7" rx="3.5" fill="#FFFFFF" opacity={0.55} />
          </G>
        </Svg>
      </FloatWrap>
    </View>
  );
}

/** Glowing QR tile */
export function HeroQrVisual({ size = 240 }: { size?: number }) {
  const cell = 14;
  // deterministic pseudo-QR pattern
  const pattern = [
    [1, 0, 1, 1, 0, 1, 1],
    [0, 1, 1, 0, 1, 0, 1],
    [1, 1, 0, 1, 1, 1, 0],
    [1, 0, 1, 0, 1, 0, 1],
    [0, 1, 1, 1, 0, 1, 1],
    [1, 0, 0, 1, 1, 0, 1],
    [1, 1, 1, 0, 1, 1, 0],
  ];
  return (
    <View style={[styles.wrap, { width: size + 100, height: size + 60 }]}>
      <Glow size={size + 100} />
      <FloatWrap range={8}>
        <Svg width={size} height={size} viewBox="0 0 220 220">
          <Defs>
            <LinearGradient id="qrFrame" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.14} />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.05} />
            </LinearGradient>
            <LinearGradient id="qrInk" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#7B9DFF" />
              <Stop offset="100%" stopColor="#9BE0FF" />
            </LinearGradient>
          </Defs>
          <Rect x="10" y="10" width="200" height="200" rx="28" fill="url(#qrFrame)" />
          {/* finder corners */}
          <Rect x="38" y="38" width="40" height="40" rx="10" stroke="url(#qrInk)" strokeWidth={5} fill="none" />
          <Rect x="142" y="38" width="40" height="40" rx="10" stroke="url(#qrInk)" strokeWidth={5} fill="none" />
          <Rect x="38" y="142" width="40" height="40" rx="10" stroke="url(#qrInk)" strokeWidth={5} fill="none" />
          {/* data cells */}
          <G transform="translate(92, 92)">
            {pattern.slice(0, 4).map((row, r) =>
              row.slice(0, 4).map((on, c) =>
                on ? (
                  <Rect
                    key={`${r}-${c}`}
                    x={c * cell}
                    y={r * cell}
                    width={cell - 4}
                    height={cell - 4}
                    rx={3}
                    fill="url(#qrInk)"
                  />
                ) : null,
              ),
            )}
          </G>
          {/* scan line */}
          <Rect x="26" y="106" width="168" height="3" rx="1.5" fill="#9BE0FF" opacity={0.8} />
        </Svg>
      </FloatWrap>
    </View>
  );
}

/** Rising chart with glow */
export function HeroChartVisual({ size = 250 }: { size?: number }) {
  return (
    <View style={[styles.wrap, { width: size + 90, height: size + 50 }]}>
      <Glow size={size + 90} />
      <FloatWrap range={9}>
        <Svg width={size} height={size * 0.82} viewBox="0 0 250 205">
          <Defs>
            <LinearGradient id="barFill" x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0%" stopColor="#FF5043" stopOpacity={0.5} />
              <Stop offset="100%" stopColor="#7B9DFF" />
            </LinearGradient>
            <LinearGradient id="lineInk" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor="#7B9DFF" />
              <Stop offset="100%" stopColor="#9BE0FF" />
            </LinearGradient>
            <LinearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.12} />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.04} />
            </LinearGradient>
          </Defs>
          <Rect x="8" y="8" width="234" height="189" rx="24" fill="url(#panel)" />
          {/* bars */}
          <Rect x="44" y="120" width="26" height="50" rx="8" fill="url(#barFill)" />
          <Rect x="84" y="98" width="26" height="72" rx="8" fill="url(#barFill)" />
          <Rect x="124" y="112" width="26" height="58" rx="8" fill="url(#barFill)" />
          <Rect x="164" y="72" width="26" height="98" rx="8" fill="url(#barFill)" />
          {/* trend line */}
          <Path
            d="M44 110 L92 84 L136 96 L196 48"
            stroke="url(#lineInk)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <Circle cx="196" cy="48" r="7" fill="#9BE0FF" />
          <Circle cx="196" cy="48" r="12" fill="#9BE0FF" opacity={0.25} />
        </Svg>
      </FloatWrap>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Path, Circle, Rect, G, Defs, LinearGradient, Stop, Ellipse, Polygon } from 'react-native-svg';
import { colors } from '../../theme';

interface IconProps {
  size?: number;
  color?: string;
}

export function ChevronDownIcon({ size = 16, color = colors.text.tertiary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 24, color = colors.text.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18l-6-6 6-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CheckIcon({ size = 20, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CloseIcon({ size = 14, color = colors.text.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 6L6 18M6 6l12 12" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}

/** OTP screen — messaging bubble with 3 dots + signal arc */
export function PhoneIcon({ size = 32, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* bubble body */}
      <Path
        d="M4 4h16a2 2 0 012 2v9a2 2 0 01-2 2H8l-4 3V6a2 2 0 012-2z"
        fill={`${color}18`}
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      {/* 3 dots */}
      <Circle cx="9" cy="10.5" r="1.1" fill={color} />
      <Circle cx="12" cy="10.5" r="1.1" fill={color} />
      <Circle cx="15" cy="10.5" r="1.1" fill={color} />
      {/* signal arc top-right */}
      <Path d="M20 3.5a3.5 3.5 0 010 4.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.6} />
    </Svg>
  );
}

/** PIN setup — two-tone shield with padlock inside */
export function ShieldIcon({ size = 32, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id="shieldFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={colors.primaryLight} />
          <Stop offset="100%" stopColor="#D4E0FF" />
        </LinearGradient>
      </Defs>
      {/* filled shield */}
      <Path
        d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z"
        fill="url(#shieldFill)"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      {/* padlock body */}
      <Rect x="9.5" y="12" width="5" height="4" rx="1" fill={color} />
      {/* padlock shackle */}
      <Path d="M10.5 12v-1.5a1.5 1.5 0 013 0V12" stroke={color} strokeWidth={1.5} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** App lock — two-tone padlock with keyhole */
export function LockIcon({ size = 32, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id="lockFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={colors.primaryLight} />
          <Stop offset="100%" stopColor="#D4E0FF" />
        </LinearGradient>
      </Defs>
      {/* shackle */}
      <Path d="M8 11V8a4 4 0 118 0v3" stroke={color} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      {/* lock body — filled */}
      <Rect x="5" y="11" width="14" height="10" rx="2" fill="url(#lockFill)" stroke={color} strokeWidth={1.8} />
      {/* keyhole: oval + triangle */}
      <Ellipse cx="12" cy="15.2" rx="1.5" ry="1.5" fill={color} />
      <Path d="M11 16.5l1 2.5 1-2.5H11z" fill={color} />
    </Svg>
  );
}

export function WalletIcon({ size = 32, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="6" width="18" height="14" rx="2" stroke={color} strokeWidth={1.8} />
      <Path d="M3 10h18" stroke={color} strokeWidth={1.8} />
      <Circle cx="17" cy="14" r="1.5" fill={color} />
    </Svg>
  );
}

export function BoltIcon({ size = 40, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}

export function ChartIcon({ size = 40, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 19V5M4 19h16" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M8 15V11M12 15V7M16 15v-4" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Biometric setup — Face ID with scan lines and two-tone treatment */
export function FaceIdIcon({ size = 48, color = colors.primary }: IconProps) {
  const dim = size;
  return (
    <Svg width={dim} height={dim} viewBox="0 0 48 48" fill="none">
      {/* corner bracket: top-left */}
      <Path d="M6 18V8h10" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
      {/* corner bracket: top-right */}
      <Path d="M42 18V8H32" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
      {/* corner bracket: bottom-left */}
      <Path d="M6 30v10h10" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
      {/* corner bracket: bottom-right */}
      <Path d="M42 30v10H32" stroke={color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
      {/* scan lines */}
      <Path d="M14 22h20" stroke={colors.primaryLight} strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
      <Path d="M14 24h20" stroke={colors.primaryLight} strokeWidth={1.4} strokeLinecap="round" opacity={0.5} />
      <Path d="M14 26h20" stroke={colors.primaryLight} strokeWidth={1.4} strokeLinecap="round" opacity={0.3} />
      {/* eyes */}
      <Circle cx="19" cy="19" r="2.2" fill={color} />
      <Circle cx="29" cy="19" r="2.2" fill={color} />
      {/* smile */}
      <Path d="M19 29c2 2.5 8 2.5 10 0" stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Biometric setup — fingerprint with 8 gradient arcs and core dot */
export function FingerprintIcon({ size = 48, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id="fpGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FF5043" />
          <Stop offset="100%" stopColor="#FF8A7A" />
        </LinearGradient>
      </Defs>
      {/* 8 concentric arcs, outermost to innermost */}
      <Path d="M3 12c0-5 4-8.5 9-8.5s9 3.5 9 8.5" stroke="url(#fpGrad)" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={1} />
      <Path d="M5 13c0-3.7 3-6.5 7-6.5s7 2.8 7 6.5c0 1.5-.3 2.8-.8 3.8" stroke="url(#fpGrad)" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.95} />
      <Path d="M7 13.5c0-2.4 2-4.5 5-4.5s5 2.1 5 4.5c0 2-.8 3.5-2 4.5" stroke="url(#fpGrad)" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.88} />
      <Path d="M9 14c0-1.5 1.2-3 3-3s3 1.5 3 3c0 1.2-.5 2.2-1.2 2.8" stroke="url(#fpGrad)" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.8} />
      <Path d="M10.5 14.2c0-.8.6-1.7 1.5-1.7s1.5.9 1.5 1.7" stroke="url(#fpGrad)" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.72} />
      <Path d="M3.5 15.5c.3 2.5 1.5 4.5 3.5 5.5" stroke="url(#fpGrad)" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.65} />
      <Path d="M20 15c-.2 1.5-.8 3-1.8 4" stroke="url(#fpGrad)" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.55} />
      <Path d="M8 20c1 1 2.5 1.5 4 1.5s3-.5 4-1.5" stroke="url(#fpGrad)" strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.45} />
      {/* core dot */}
      <Circle cx="12" cy="14.2" r="1.2" fill="#FF5043" />
    </Svg>
  );
}

/** Completion moment — filled green circle + white checkmark + pulse ring */
export function SuccessCheckIcon({ size = 64 }: { size?: number }) {
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.28)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(pulseScale, { toValue: 1.45, duration: 700, useNativeDriver: true }),
      Animated.timing(pulseOpacity, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();
  }, [pulseOpacity, pulseScale]);

  return (
    <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* pulse ring */}
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.success,
          transform: [{ scale: pulseScale }],
          opacity: pulseOpacity,
        }}
      />
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <Defs>
          <LinearGradient id="successBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#1F9D55" />
            <Stop offset="100%" stopColor="#178244" />
          </LinearGradient>
        </Defs>
        {/* filled circle background */}
        <Circle cx="32" cy="32" r="30" fill="url(#successBg)" />
        {/* white checkmark — filled path */}
        <Path
          d="M18 32l10 10 18-18"
          stroke="#FFFFFF"
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

export function StoreIcon({ size = 32, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 9l2-4h14l2 4" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Rect x="4" y="9" width="16" height="11" rx="1" stroke={color} strokeWidth={1.8} />
      <Path d="M10 20v-5h4v5" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

export function HandshakeIcon({ size = 28, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 11l3 3 4-4 3 3v5H7v-7z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** QR code — finder corners + module grid */
export function QrCodeIcon({ size = 24, color = colors.text.primary }: IconProps) {
  const s = 2.2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth={1.8} />
      <Rect x="5" y="5" width="3" height="3" fill={color} />
      <Rect x="14" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth={1.8} />
      <Rect x="16" y="5" width="3" height="3" fill={color} />
      <Rect x="3" y="14" width="7" height="7" rx="1.5" stroke={color} strokeWidth={1.8} />
      <Rect x="5" y="16" width="3" height="3" fill={color} />
      <Rect x="14" y="14" width={s} height={s} fill={color} />
      <Rect x="18" y="14" width={s} height={s} fill={color} />
      <Rect x="14" y="18" width={s} height={s} fill={color} />
      <Rect x="18" y="18" width={s} height={s} fill={color} />
      <Rect x="16" y="16" width={s} height={s} fill={color} />
    </Svg>
  );
}

/** App logo mark — horizontal gradient background + bold Q glyph */
export function BrandMarkIcon({ size = 48, onDark = true }: { size?: number; onDark?: boolean }) {
  const bg = onDark ? '#FF5043' : '#FF5043';
  const container = onDark ? 'rgba(255,80,67,0.15)' : '#FF5043';
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Rect width="100" height="100" rx="26" fill={onDark ? 'rgba(255,80,67,0.15)' : '#FF5043'} />
      {/* Zapp bolt — coral on dark bg, white on coral bg */}
      <Polygon
        points="57,8 26,54 45,54 43,92 74,44 55,44"
        fill={onDark ? '#FF5043' : '#FFFFFF'}
        stroke={onDark ? '#FF5043' : '#FFFFFF'}
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

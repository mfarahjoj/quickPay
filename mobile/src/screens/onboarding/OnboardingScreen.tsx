import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Dimensions,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import Svg, { Circle, Rect, Path, Polygon } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const { width: SW } = Dimensions.get('window');

// ─── Brand colours (dark kinetic theme) ───────────────────────
const CORAL = '#FF5043';
const CANVAS = '#0D0B0A';
const CHIP_BG = '#1C1917';
const CHIP_BORDER = 'rgba(255,255,255,0.09)';
const TEXT = '#F5F1EE';
const DIM = '#A89F98';
const FAINT = '#6B6560';
const TEAL = '#5DCAA5';
const TEAL_DARK = '#04342C';
const CREAM = '#FBFAF8';
const INK = '#14110F';

// ─── Icons ────────────────────────────────────────────────────

function BoltIcon({ size = 24, color = CORAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Polygon
        points="57,8 26,54 45,54 43,92 74,44 55,44"
        fill={color}
        stroke={color}
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CheckIcon({ size = 16, color = TEAL_DARK }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12.5 L10 17.5 L19 7" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function StoreIcon({ size = 14, color = TEAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 9 L5.5 4 H18.5 L20 9 M5 9 V19 A1 1 0 0 0 6 20 H18 A1 1 0 0 0 19 19 V9 M9.5 20 V14 H14.5 V20"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function UserIcon({ size = 14, color = CORAL }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth="1.8" />
      <Path d="M5 20 Q5 14.5 12 14.5 Q19 14.5 19 20" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

function LockIcon({ size = 40, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" stroke={color} strokeWidth="2" />
      <Path d="M8.5 10.5 V7.5 A3.5 3.5 0 0 1 15.5 7.5 V10.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Circle cx="12" cy="15.2" r="1.4" fill={color} />
    </Svg>
  );
}

// ─── QR pattern ───────────────────────────────────────────────

function QrSvg({ size, bg = CREAM }: { size: number; bg?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x="4" y="4" width="24" height="24" rx="3" fill={INK} />
      <Rect x="9" y="9" width="14" height="14" rx="2" fill={bg} />
      <Rect x="13" y="13" width="6" height="6" fill={INK} />
      <Rect x="72" y="4" width="24" height="24" rx="3" fill={INK} />
      <Rect x="77" y="9" width="14" height="14" rx="2" fill={bg} />
      <Rect x="81" y="13" width="6" height="6" fill={INK} />
      <Rect x="4" y="72" width="24" height="24" rx="3" fill={INK} />
      <Rect x="9" y="77" width="14" height="14" rx="2" fill={bg} />
      <Rect x="13" y="81" width="6" height="6" fill={INK} />
      <Rect x="40" y="8" width="8" height="8" fill={INK} />
      <Rect x="54" y="16" width="8" height="8" fill={INK} />
      <Rect x="8" y="40" width="8" height="8" fill={INK} />
      <Rect x="22" y="48" width="8" height="8" fill={INK} />
      <Rect x="38" y="40" width="8" height="8" fill={INK} />
      <Rect x="48" y="46" width="12" height="12" rx="2" fill={CORAL} />
      <Rect x="68" y="40" width="8" height="8" fill={INK} />
      <Rect x="84" y="46" width="8" height="8" fill={INK} />
      <Rect x="42" y="64" width="8" height="8" fill={INK} />
      <Rect x="58" y="70" width="8" height="8" fill={INK} />
      <Rect x="74" y="64" width="8" height="8" fill={INK} />
      <Rect x="40" y="84" width="8" height="8" fill={INK} />
      <Rect x="56" y="86" width="8" height="8" fill={INK} />
      <Rect x="76" y="82" width="8" height="8" fill={INK} />
    </Svg>
  );
}

// ─── Shared loop helpers ──────────────────────────────────────

function useLoop(duration: number): Animated.Value {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [t, duration]);
  return t;
}

function useRipple(duration: number, delay: number): Animated.Value {
  const r = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(r, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [r, duration, delay]);
  return r;
}

function Ring({ size, color, duration, delay, maxScale = 2.1 }: {
  size: number; color: string; duration: number; delay: number; maxScale?: number;
}) {
  const r = useRipple(duration, delay);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [0.5, maxScale] }) }],
        opacity: r.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.9, 0.4, 0] }),
      }}
    />
  );
}

function Spark({ x, bottom, color, delay }: { x: number; bottom: number; color: string; delay: number }) {
  const s = useRipple(4200, delay);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        bottom,
        width: 5,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: color,
        transform: [{ translateY: s.interpolate({ inputRange: [0, 1], outputRange: [0, -120] }) }],
        opacity: s.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 0.75, 0.3, 0] }),
      }}
    />
  );
}

// ─── Slide 1: Bolt core with orbiting payments ────────────────

function OrbitChip({ children, angleStyle, counterRotate }: {
  children: React.ReactNode;
  angleStyle: object;
  counterRotate: Animated.AnimatedInterpolation<string>;
}) {
  return (
    <Animated.View style={[s1.chip, angleStyle, { transform: [{ rotate: counterRotate }] }]}>
      {children}
    </Animated.View>
  );
}

function Slide1Illo() {
  const orbit = useLoop(16000);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.07, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const spin = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const unspin = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  return (
    <View style={s1.wrap}>
      <Spark x={SW * 0.2} bottom={70} color={CORAL} delay={0} />
      <Spark x={SW * 0.75} bottom={84} color={CORAL} delay={1200} />
      <Spark x={SW * 0.6} bottom={50} color={CORAL} delay={2300} />
      <Spark x={SW * 0.34} bottom={42} color={CORAL} delay={3100} />

      <Ring size={120} color="rgba(255,80,67,0.55)" duration={3200} delay={0} />
      <Ring size={120} color="rgba(255,80,67,0.55)" duration={3200} delay={1050} />
      <Ring size={120} color="rgba(255,80,67,0.55)" duration={3200} delay={2100} />

      <Animated.View style={[s1.orbitRing, { transform: [{ rotate: spin }] }]}>
        <OrbitChip angleStyle={s1.chipTop} counterRotate={unspin}>
          <View style={s1.avatar}>
            <Text style={s1.avatarText}>A</Text>
          </View>
          <Text style={s1.chipText}>Amina · $12</Text>
        </OrbitChip>
        <OrbitChip angleStyle={s1.chipLeft} counterRotate={unspin}>
          <StoreIcon size={13} />
          <Text style={s1.chipText}>Duka · $4.50</Text>
        </OrbitChip>
        <OrbitChip angleStyle={s1.chipRight} counterRotate={unspin}>
          <CheckIcon size={13} color={TEAL} />
          <Text style={s1.chipText}>Paid</Text>
        </OrbitChip>
      </Animated.View>

      <Animated.View style={[s1.core, { transform: [{ scale: pulse }] }]}>
        <BoltIcon size={44} color="#FFFFFF" />
      </Animated.View>
    </View>
  );
}

const s1 = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  orbitRing: {
    position: 'absolute',
    width: 236,
    height: 236,
    borderRadius: 118,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  core: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: CORAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CHIP_BG,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipTop: { top: -16, left: 66 },
  chipLeft: { bottom: 10, left: -24 },
  chipRight: { bottom: 28, right: -20 },
  chipText: { fontSize: 11, fontWeight: '500', color: TEXT },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FDE4CB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 9, fontWeight: '700', color: '#8A4B0F' },
});

// ─── Slide 2: Two-phone camera lock-on scan ───────────────────

const SCAN_LOOP = 5600;

function Slide2Illo() {
  const t = useLoop(SCAN_LOOP);
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -6, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [bob]);

  // Merchant phone slides in, holds, retreats
  const bX = t.interpolate({ inputRange: [0, 0.14, 0.86, 0.96, 1], outputRange: [90, 0, 0, 90, 90] });
  const bY = t.interpolate({ inputRange: [0, 0.14, 0.86, 0.96, 1], outputRange: [-50, 0, 0, -50, -50] });
  const bRot = t.interpolate({ inputRange: [0, 0.14, 0.86, 0.96, 1], outputRange: ['16deg', '7deg', '7deg', '16deg', '16deg'] });
  const bOp = t.interpolate({ inputRange: [0, 0.14, 0.86, 0.96, 1], outputRange: [0, 1, 1, 0, 0] });

  // QR drifts into camera frame and settles (focus)
  const qOp = t.interpolate({ inputRange: [0, 0.07, 0.24, 0.9, 1], outputRange: [0, 0, 1, 1, 0] });
  const qScale = t.interpolate({ inputRange: [0, 0.07, 0.24, 1], outputRange: [1.45, 1.45, 1, 1] });
  const qX = t.interpolate({ inputRange: [0, 0.07, 0.24, 1], outputRange: [16, 16, 0, 0] });
  const qY = t.interpolate({ inputRange: [0, 0.07, 0.24, 1], outputRange: [22, 22, 0, 0] });
  const qRot = t.interpolate({ inputRange: [0, 0.07, 0.24, 1], outputRange: ['6deg', '6deg', '0deg', '0deg'] });

  // Viewfinder brackets lock on with overshoot
  const lockScale = t.interpolate({ inputRange: [0, 0.12, 0.24, 0.3, 1], outputRange: [1.24, 1.24, 0.95, 1, 1] });
  const lockOp = t.interpolate({ inputRange: [0, 0.12, 0.24, 0.88, 0.96, 1], outputRange: [0.3, 0.3, 1, 1, 0.3, 0.3] });

  // Beam sweeps after lock
  const beamY = t.interpolate({ inputRange: [0, 0.3, 0.58, 1], outputRange: [56, 56, 167, 167] });
  const beamOp = t.interpolate({ inputRange: [0, 0.3, 0.34, 0.58, 0.63, 1], outputRange: [0, 0, 1, 1, 0, 0] });

  // Success flash + checks
  const flashOp = t.interpolate({ inputRange: [0, 0.62, 0.68, 0.84, 0.92, 1], outputRange: [0, 0, 1, 1, 0, 0] });
  const checkScale = t.interpolate({ inputRange: [0, 0.62, 0.7, 0.86, 0.94, 1], outputRange: [0, 0, 1.15, 1, 0.7, 0.7] });
  const checkOp = t.interpolate({ inputRange: [0, 0.62, 0.7, 0.86, 0.94, 1], outputRange: [0, 0, 1, 1, 0, 0] });

  return (
    <View style={s2.wrap}>
      <View style={s2.scene}>
      {/* Customer phone */}
      <Animated.View style={[s2.phoneA, { transform: [{ translateY: bob }, { rotate: '-7deg' }] }]}>
        <View style={s2.phoneAFrame}>
          <View style={s2.phoneAScreen}>
            <View style={s2.notch} />
            <QrSvg size={78} />
            <Text style={s2.amount}>$4.50</Text>
            <Animated.View style={[s2.checkA, { transform: [{ scale: checkScale }], opacity: checkOp }]}>
              <CheckIcon size={19} />
            </Animated.View>
          </View>
        </View>
        <View style={s2.roleChipWrap}>
          <View style={s2.roleChip}>
            <UserIcon size={13} />
            <Text style={s2.roleText}>You</Text>
          </View>
        </View>
      </Animated.View>

      {/* Merchant phone */}
      <Animated.View
        style={[s2.phoneB, { opacity: bOp, transform: [{ translateX: bX }, { translateY: bY }, { rotate: bRot }] }]}
      >
        <View style={s2.phoneBFrame}>
          <View style={s2.phoneBScreen}>
            <Animated.View
              style={[
                s2.cameraQr,
                { opacity: qOp, transform: [{ translateX: qX }, { translateY: qY }, { scale: qScale }, { rotate: qRot }] },
              ]}
            >
              <View style={s2.cameraQrCard}>
                <QrSvg size={64} />
              </View>
            </Animated.View>

            <Animated.View style={[StyleSheet.absoluteFill, { opacity: lockOp, transform: [{ scale: lockScale }] }]}>
              <View style={[s2.corner, s2.cornerTL]} />
              <View style={[s2.corner, s2.cornerTR]} />
              <View style={[s2.corner, s2.cornerBL]} />
              <View style={[s2.corner, s2.cornerBR]} />
            </Animated.View>

            <Animated.View style={[s2.beam, { opacity: beamOp, transform: [{ translateY: beamY }] }]} />
            <Animated.View style={[StyleSheet.absoluteFill, s2.flash, { opacity: flashOp }]} />
            <Animated.View style={[s2.checkB, { transform: [{ scale: checkScale }], opacity: checkOp }]}>
              <CheckIcon size={24} />
            </Animated.View>
            <View style={s2.shutter} />
          </View>
        </View>
        <View style={s2.roleChipWrap}>
          <View style={s2.roleChip}>
            <StoreIcon size={13} />
            <Text style={s2.roleText}>Merchant</Text>
          </View>
        </View>
      </Animated.View>
      </View>
    </View>
  );
}

const s2 = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scene: { width: 300, height: 310 },
  phoneA: { position: 'absolute', left: 8, top: 44, width: 118 },
  phoneAFrame: {
    backgroundColor: CHIP_BG,
    borderRadius: 20,
    padding: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  phoneAScreen: {
    backgroundColor: CREAM,
    borderRadius: 16,
    height: 196,
    alignItems: 'center',
    paddingTop: 10,
  },
  notch: { width: 34, height: 6, borderRadius: 3, backgroundColor: CHIP_BG, marginBottom: 12 },
  amount: { fontSize: 10, fontWeight: '600', color: FAINT, marginTop: 8, letterSpacing: 0.3 },
  checkA: {
    position: 'absolute',
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneB: { position: 'absolute', right: 0, top: 12, width: 140 },
  phoneBFrame: {
    backgroundColor: '#000000',
    borderRadius: 24,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  phoneBScreen: {
    backgroundColor: '#131110',
    borderRadius: 19,
    height: 232,
    overflow: 'hidden',
  },
  cameraQr: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  cameraQrCard: { backgroundColor: CREAM, borderRadius: 8, padding: 8, opacity: 0.92 },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: CORAL },
  cornerTL: { top: 16, left: 16, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 6 },
  cornerTR: { top: 16, right: 16, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 6 },
  cornerBL: { bottom: 38, left: 16, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 38, right: 16, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 6 },
  beam: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: CORAL,
  },
  flash: { backgroundColor: 'rgba(93,202,165,0.16)' },
  checkB: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -22,
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutter: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    marginLeft: -13,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  roleChipWrap: { alignItems: 'center', marginTop: 10 },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: CHIP_BG,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  roleText: { fontSize: 11, fontWeight: '500', color: TEXT },
});

// ─── Slide 3: Approve with PIN ────────────────────────────────

const PIN_LOOP = 3600;

function Slide3Illo() {
  const t = useLoop(PIN_LOOP);

  const notifY = t.interpolate({ inputRange: [0, 0.08, 0.88, 1], outputRange: [-18, 0, 0, 0] });
  const notifOp = t.interpolate({ inputRange: [0, 0.08, 0.88, 0.96, 1], outputRange: [0, 1, 1, 0, 0] });

  const checkScale = t.interpolate({ inputRange: [0, 0.52, 0.6, 0.88, 0.96, 1], outputRange: [0, 0, 1.15, 1, 0.8, 0.8] });
  const checkOp = t.interpolate({ inputRange: [0, 0.52, 0.6, 0.88, 0.96, 1], outputRange: [0, 0, 1, 1, 0, 0] });

  const dotAt = (start: number) => ({
    opacity: t.interpolate({
      inputRange: [0, start, Math.min(start + 0.04, 1), 0.78, 0.86, 1],
      outputRange: [0, 0, 1, 1, 0, 0],
    }),
    transform: [
      {
        scale: t.interpolate({
          inputRange: [0, start, Math.min(start + 0.04, 1), Math.min(start + 0.08, 1), 1],
          outputRange: [0.5, 0.5, 1.25, 1, 1],
        }),
      },
    ],
  });

  return (
    <View style={s3.wrap}>
      <Animated.View style={[s3.notif, { opacity: notifOp, transform: [{ translateY: notifY }] }]}>
        <View style={s3.notifIcon}>
          <BoltIcon size={16} color="#FFFFFF" />
        </View>
        <View style={s3.notifBody}>
          <Text style={s3.notifApp}>ZAPP PAY · NOW</Text>
          <Text style={s3.notifMsg}>Approve $4.50 to Salaama Store</Text>
        </View>
      </Animated.View>

      <View style={s3.coreWrap}>
        <Ring size={120} color="rgba(255,80,67,0.5)" duration={PIN_LOOP} delay={0} maxScale={1.9} />
        <Ring size={120} color="rgba(255,80,67,0.5)" duration={PIN_LOOP} delay={1200} maxScale={1.9} />
        <View style={s3.core}>
          <LockIcon size={40} />
        </View>
        <Animated.View style={[s3.check, { transform: [{ scale: checkScale }], opacity: checkOp }]}>
          <CheckIcon size={20} />
        </Animated.View>
      </View>

      <View style={s3.dots}>
        {[0.14, 0.21, 0.28, 0.35].map((start) => (
          <View key={start} style={s3.dotShell}>
            <Animated.View style={[s3.dotFill, dotAt(start)]} />
          </View>
        ))}
      </View>
    </View>
  );
}

const s3 = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26 },
  notif: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: CHIP_BG,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: 246,
  },
  notifIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: CORAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBody: { flex: 1 },
  notifApp: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: DIM },
  notifMsg: { fontSize: 13, fontWeight: '600', color: TEXT, marginTop: 2 },
  coreWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  core: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: CORAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 12 },
  dotShell: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotFill: { width: 15, height: 15, borderRadius: 7.5, backgroundColor: CORAL },
});

// ─── Slide data ────────────────────────────────────────────────

// `dwell` is how long a slide holds before the next one dissolves in. Each is
// tuned to its own illustration's loop so the little story finishes on screen
// rather than getting cut off mid-scan.
const SLIDES = [
  {
    key: 'speed',
    headlinePlain: 'Money at the\nspeed of ',
    headlineAccent: 'Zapp.',
    sub: 'Pay anyone in Hargeisa before they finish saying mahadsanid.',
    dwell: 5200,
    Illo: Slide1Illo,
  },
  {
    key: 'scan',
    headlinePlain: 'Show your QR.\n',
    headlineAccent: 'They scan.',
    sub: 'Any merchant, any phone — paid in seconds.',
    dwell: SCAN_LOOP + 700,
    Illo: Slide2Illo,
  },
  {
    key: 'pin',
    headlinePlain: 'Only you can\n',
    headlineAccent: 'say yes.',
    sub: 'Every charge pings your phone and waits for your PIN. No PIN, no payment.',
    dwell: PIN_LOOP + 1100,
    Illo: Slide3Illo,
  },
];

type Slide = (typeof SLIDES)[number];

// Cross-fade, not a page turn — the slides should read as one continuous
// backdrop behind the buttons rather than a carousel you're expected to work.
const FADE_MS = 720;
const DRIFT = 20;

function SlidePanel({ slide }: { slide: Slide }) {
  const Illo = slide.Illo;
  return (
    <View style={ob.panel}>
      <View style={ob.illo}>
        <Illo />
      </View>
      <View style={ob.txt}>
        <Text style={ob.headline}>
          {slide.headlinePlain}
          <Text style={ob.headlineAccent}>{slide.headlineAccent}</Text>
        </Text>
        <Text style={ob.sub}>{slide.sub}</Text>
      </View>
    </View>
  );
}

// ─── Main component ────────────────────────────────────────────

interface Props {
  onGetStarted: () => void;
  onLogin: () => void;
}

// A layer is one panel on screen. `seq` is its React key: the outgoing panel
// keeps the seq it was mounted with so it never remounts mid-dissolve, while
// the incoming one always gets a fresh seq so its animation restarts from the
// top each time it comes round.
type Layer = { idx: number; seq: number; dir: 1 | -1 };

export default function OnboardingScreen({ onGetStarted, onLogin }: Props) {
  const [front, setFront] = useState<Layer>({ idx: 0, seq: 0, dir: 1 });
  const [back, setBack] = useState<Layer | null>(null);
  const mix = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const frontRef = useRef(front);
  const seqRef = useRef(0);

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    Animated.spring(rise, { toValue: 1, tension: 60, friction: 12, useNativeDriver: true }).start();
  }, [fadeIn, rise]);

  const goTo = useCallback(
    (idx: number, dir: 1 | -1) => {
      const cur = frontRef.current;
      if (idx === cur.idx) return;
      seqRef.current += 1;
      const next: Layer = { idx, seq: seqRef.current, dir };
      // Updated before the state commit so a double-fire in the same tick is a
      // no-op rather than a second dissolve.
      frontRef.current = next;
      setBack(cur);
      setFront(next);
      mix.setValue(0);
      Animated.timing(mix, {
        toValue: 1,
        duration: FADE_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setBack(null);
      });
    },
    [mix],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const cur = frontRef.current.idx;
      goTo((cur + dir + SLIDES.length) % SLIDES.length, dir);
    },
    [goTo],
  );

  // Auto-play. Keyed on `front`, so a manual swipe restarts the dwell for free
  // instead of advancing again a moment later under the user's thumb.
  useEffect(() => {
    const timer = setTimeout(() => step(1), SLIDES[front.idx].dwell);
    return () => clearTimeout(timer);
  }, [front, step]);

  // Horizontal swipe: left → next slide, right → previous, wrapping at both
  // ends. Runs on the JS thread so it can call step/setState directly; only
  // activates on a clear horizontal drag so taps and vertical gestures still
  // pass through.
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-18, 18])
    .failOffsetY([-24, 24])
    .onEnd((e) => {
      const passedDistance = Math.abs(e.translationX) > SW * 0.22;
      const passedVelocity = Math.abs(e.velocityX) > 500;
      if (!passedDistance && !passedVelocity) return;
      step(e.translationX < 0 ? 1 : -1);
    });

  const riseStyle = {
    opacity: rise,
    transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }],
  };

  const frontStyle = {
    opacity: mix,
    transform: [
      { translateX: mix.interpolate({ inputRange: [0, 1], outputRange: [front.dir * DRIFT, 0] }) },
    ],
  };

  const backStyle = {
    opacity: mix.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [
      { translateX: mix.interpolate({ inputRange: [0, 1], outputRange: [0, front.dir * -DRIFT] }) },
    ],
  };

  return (
    <SafeAreaView style={ob.root}>
      <StatusBar barStyle="light-content" backgroundColor={CANVAS} />
      <Animated.View style={[ob.inner, { opacity: fadeIn }]}>

        {/* Wordmark */}
        <View style={ob.topRow}>
          <View style={ob.wordmark}>
            <BoltIcon size={20} color={CORAL} />
            <Text style={ob.brand}>
              <Text style={ob.brandBold}>Zapp</Text>
              {' '}
              <Text style={ob.brandLight}>Pay</Text>
            </Text>
          </View>
        </View>

        {/* Auto-playing backdrop: illustration + headline dissolve together */}
        <GestureDetector gesture={swipe}>
          <View style={ob.stage}>
            {back && (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, backStyle]}>
                <SlidePanel key={back.seq} slide={SLIDES[back.idx]} />
              </Animated.View>
            )}
            <Animated.View style={[StyleSheet.absoluteFill, frontStyle]}>
              <SlidePanel key={front.seq} slide={SLIDES[front.idx]} />
            </Animated.View>
          </View>
        </GestureDetector>

        {/* Fixed entry points — never tied to which slide is showing */}
        <Animated.View style={[ob.btm, riseStyle]}>
          <TouchableOpacity style={ob.primaryBtn} onPress={onGetStarted} activeOpacity={0.85}>
            <Text style={ob.primaryText}>Get started</Text>
            <BoltIcon size={18} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity style={ob.secondaryBtn} onPress={onLogin} activeOpacity={0.7}>
            <Text style={ob.secondaryText}>Log in</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </SafeAreaView>
  );
}

const ob = StyleSheet.create({
  root: { flex: 1, backgroundColor: CANVAS },
  inner: { flex: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brand: { fontSize: 16, letterSpacing: -0.3 },
  brandBold: { fontWeight: '700', color: TEXT },
  brandLight: { fontWeight: '400', color: CORAL },
  stage: { flex: 1 },
  panel: { flex: 1 },
  illo: { flex: 1, minHeight: 280 },
  txt: { paddingHorizontal: 26, flexShrink: 0 },
  headline: {
    fontSize: 36,
    fontWeight: '800',
    color: TEXT,
    letterSpacing: -1.5,
    lineHeight: 40,
  },
  headlineAccent: { color: CORAL },
  sub: {
    fontSize: 14,
    fontWeight: '400',
    color: DIM,
    lineHeight: 21,
    marginTop: 12,
  },
  btm: { flexShrink: 0, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 14 },
  primaryBtn: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: CORAL,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  secondaryBtn: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryText: { color: TEXT, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
});

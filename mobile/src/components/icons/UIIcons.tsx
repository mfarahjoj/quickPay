import React from 'react';
import Svg, { Path, Circle, Rect, G, Line, Ellipse } from 'react-native-svg';
import { colors } from '../../theme';

interface IconProps {
  size?: number;
  color?: string;
}

// ─── Menu Icons ──────────────────────────────────────────────

export function IDCardIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="5" width="20" height="14" rx="2" stroke={color} strokeWidth={1.8} />
      <Circle cx="8.5" cy="11" r="2.5" stroke={color} strokeWidth={1.6} />
      <Path d="M13 9h5M13 12h4M13 15h3" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function LinkIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BellIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function InfoIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={1.8} />
      <Path d="M12 16v-4M12 8h.01" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function QRSquareIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth={1.8} />
      <Rect x="5" y="5" width="3" height="3" fill={color} />
      <Rect x="14" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth={1.8} />
      <Rect x="16" y="5" width="3" height="3" fill={color} />
      <Rect x="3" y="14" width="7" height="7" rx="1.5" stroke={color} strokeWidth={1.8} />
      <Rect x="5" y="16" width="3" height="3" fill={color} />
      <Rect x="14" y="14" width="2.5" height="2.5" fill={color} />
      <Rect x="18.5" y="14" width="2.5" height="2.5" fill={color} />
      <Rect x="14" y="18.5" width="2.5" height="2.5" fill={color} />
      <Rect x="18.5" y="18.5" width="2.5" height="2.5" fill={color} />
      <Rect x="16.25" y="16.25" width="2.5" height="2.5" fill={color} />
    </Svg>
  );
}

// ─── Notification Type Icons ─────────────────────────────────

export function MoneyInIcon({ size = 24, color = colors.dark.incoming }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Wallet */}
      <Rect x="2" y="7" width="15" height="12" rx="2" stroke={color} strokeWidth={1.8} />
      <Path d="M2 11h15" stroke={color} strokeWidth={1.6} />
      <Circle cx="10.5" cy="14.5" r="1.2" fill={color} />
      {/* Arrow in */}
      <Path d="M19 3v8M19 11l-2.5-2.5M19 11l2.5-2.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function MoneyOutIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Wallet */}
      <Rect x="2" y="7" width="15" height="12" rx="2" stroke={color} strokeWidth={1.8} />
      <Path d="M2 11h15" stroke={color} strokeWidth={1.6} />
      <Circle cx="10.5" cy="14.5" r="1.2" fill={color} />
      {/* Arrow out */}
      <Path d="M19 11V3M19 3l-2.5 2.5M19 3l2.5 2.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CardIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="5" width="20" height="14" rx="2" stroke={color} strokeWidth={1.8} />
      <Path d="M2 10h20" stroke={color} strokeWidth={1.8} />
      <Rect x="5" y="14" width="4" height="2" rx="0.5" fill={color} opacity={0.6} />
      {/* Chip */}
      <Rect x="5" y="7" width="4" height="3" rx="0.8" stroke={color} strokeWidth={1.4} />
    </Svg>
  );
}

export function BankIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Roof / triangle top */}
      <Path d="M3 10L12 3l9 7H3z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" fill="none" />
      {/* Columns */}
      <Path d="M5 10v8M9 10v8M15 10v8M19 10v8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      {/* Base */}
      <Path d="M3 18h18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M2 21h20" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function GiftIcon({ size = 24, color = colors.dark.textDim }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="10" width="18" height="12" rx="2" stroke={color} strokeWidth={1.8} />
      <Rect x="2" y="6" width="20" height="5" rx="1.5" stroke={color} strokeWidth={1.8} />
      <Path d="M12 6v16" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M2 8.5h20" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <Path d="M12 6 Q8 2 10 1 Q12 4 12 6" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 6 Q16 2 14 1 Q12 4 12 6" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ─── Empty State Illustrations (120×120) ─────────────────────

export function EmptyTransactionsIcon({ size = 120, color = colors.dark.textFaint }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      {/* Receipt paper */}
      <Rect x="25" y="10" width="70" height="85" rx="6" stroke={color} strokeWidth={2.5} />
      {/* Zigzag bottom */}
      <Path d="M25 88l7-8 7 8 7-8 7 8 7-8 7 8 7-8 7 8" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Lines (text rows) */}
      <Path d="M38 28h44" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
      <Path d="M38 40h30" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.4} />
      <Path d="M38 52h44" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
      <Path d="M38 64h24" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.4} />
      {/* Coin/amount bottom right */}
      <Circle cx="80" cy="64" r="10" stroke={color} strokeWidth={2} opacity={0.5} />
      <Path d="M80 59v10M77 61h5a2 2 0 010 4h-5" stroke={color} strokeWidth={1.8} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}

export function EmptyNotificationsIcon({ size = 120, color = colors.dark.textFaint }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      {/* Bell body */}
      <Path
        d="M60 18a30 30 0 0130 30v18l8 12H22l8-12V48A30 30 0 0160 18z"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {/* Bell clapper */}
      <Path d="M52 90a8 8 0 0016 0" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      {/* ZZZ — sleeping */}
      <Path d="M76 26h10l-10 9h10" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
      <Path d="M80 16h7l-7 6h7" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.35} />
    </Svg>
  );
}

export function EmptyRequestsIcon({ size = 120, color = colors.dark.textFaint }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      {/* Document */}
      <Rect x="22" y="12" width="60" height="76" rx="6" stroke={color} strokeWidth={2.5} />
      {/* Folded corner */}
      <Path d="M64 12l18 18h-18V12z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {/* Checklist lines */}
      <Circle cx="37" cy="44" r="4" stroke={color} strokeWidth={2} opacity={0.6} />
      <Path d="M47 44h22" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
      <Circle cx="37" cy="58" r="4" stroke={color} strokeWidth={2} opacity={0.4} />
      <Path d="M47 58h18" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.4} />
      <Circle cx="37" cy="72" r="4" stroke={color} strokeWidth={2} opacity={0.25} />
      <Path d="M47 72h14" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.25} />
      {/* Plus circle bottom right */}
      <Circle cx="88" cy="88" r="18" fill={`${color}12`} stroke={color} strokeWidth={2} />
      <Path d="M88 80v16M80 88h16" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}

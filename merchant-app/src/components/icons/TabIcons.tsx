import React from 'react';
import Svg, { Path, Rect, Circle, Line } from 'react-native-svg';

interface TabIconProps {
  color: string;
  focused?: boolean;
  size?: number;
}

/**
 * Bottom-tab icons in the QuickPay stroke style.
 * `focused` thickens the stroke and adds a subtle fill so the active
 * tab reads clearly without a separate filled glyph set.
 */

const STROKE = 2;
const STROKE_FOCUSED = 2.4;

function useStroke(focused?: boolean) {
  return focused ? STROKE_FOCUSED : STROKE;
}

/** Home — house outline */
export function HomeTabIcon({ color, focused, size = 24 }: TabIconProps) {
  const sw = useStroke(focused);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 10.5L12 3l9 7.5"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5 9.5V20a1 1 0 001 1h12a1 1 0 001-1V9.5"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        fill={focused ? `${color}1A` : 'none'}
      />
      {focused && <Rect x="10" y="14" width="4" height="7" rx="1" fill={color} />}
    </Svg>
  );
}

/** Scan — viewfinder brackets + center scan line */
export function ScanTabIcon({ color, focused, size = 24 }: TabIconProps) {
  const sw = useStroke(focused);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8V6a2 2 0 012-2h2" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Path d="M16 4h2a2 2 0 012 2v2" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Path d="M20 16v2a2 2 0 01-2 2h-2" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Path d="M8 20H6a2 2 0 01-2-2v-2" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </Svg>
  );
}

/** Receive — QR code mark */
export function ReceiveTabIcon({ color, focused, size = 24 }: TabIconProps) {
  const sw = useStroke(focused);
  const fill = focused ? `${color}1A` : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth={sw} fill={fill} />
      <Rect x="14" y="3" width="7" height="7" rx="1.5" stroke={color} strokeWidth={sw} fill={fill} />
      <Rect x="3" y="14" width="7" height="7" rx="1.5" stroke={color} strokeWidth={sw} fill={fill} />
      <Path
        d="M14 14h3v3M21 14v7h-7v-3"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** History — clock */
export function HistoryTabIcon({ color, focused, size = 24 }: TabIconProps) {
  const sw = useStroke(focused);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={sw} fill={focused ? `${color}14` : 'none'} />
      <Path d="M12 7v5l3.5 2" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Settings — gear (8 teeth) */
export function SettingsTabIcon({ color, focused, size = 24 }: TabIconProps) {
  const sw = useStroke(focused);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={focused ? `${color}14` : 'none'}
      />
      <Path
        d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

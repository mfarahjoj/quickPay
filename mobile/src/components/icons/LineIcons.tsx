import React from 'react';
import { I18nManager } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

// Line icons for the light screens: 24-unit grid, round caps and joins.

interface IconProps {
  size?: number;
  color: string;
  strokeWidth?: number;
}

function Line({
  size = 24,
  color,
  strokeWidth = 2,
  flipInRtl = false,
  children,
}: IconProps & { flipInRtl?: boolean; children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={flipInRtl && I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      <G fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </G>
    </Svg>
  );
}

export function QrIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z" />
      <Path
        d="M14 14h2.6v2.6H14z M17.4 17.4H20V20h-2.6z M14 17.4h2.6V20H14z M17.4 14H20v2.6h-2.6z"
        fill={props.color}
        stroke="none"
      />
    </Line>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M12 5v14 M5 12h14" />
    </Line>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M4 8V6a2 2 0 0 1 2-2h2 M16 4h2a2 2 0 0 1 2 2v2 M20 16v2a2 2 0 0 1-2 2h-2 M8 20H6a2 2 0 0 1-2-2v-2 M4 12h16" />
    </Line>
  );
}

export function CashIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M3 7.5h18v10H3z M6.5 10.5v4 M17.5 10.5v4" />
      <Circle cx={12} cy={12.5} r={2.4} />
    </Line>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M4 9.5 5.5 4.5h13L20 9.5 M4.5 9.5v10h15v-10 M4 9.5h16 M9.5 19.5v-5h5v5" />
    </Line>
  );
}

/** Money coming in: an arrow pointing down and in. */
export function ArrowInIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M17 7 7 17 M7 9.5V17h7.5" />
    </Line>
  );
}

/** Money going out: an arrow pointing up and out. */
export function ArrowOutIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M7 17 17 7 M9.5 7H17v7.5" />
    </Line>
  );
}

export function RefundIcon(props: IconProps) {
  return (
    <Line {...props} flipInRtl>
      <Path d="M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Line>
  );
}

export function GiftIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M4 10h16v10H4z M3 7h18v3H3z M12 7v13 M12 7c-1.5-3-5-3.5-5-1.2C7 7 9.5 7 12 7z M12 7c1.5-3 5-3.5 5-1.2C17 7 14.5 7 12 7z" />
    </Line>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Line {...props} flipInRtl>
      <Path d="M21 3 10 14 M21 3l-7 18-4-7-7-4z" />
    </Line>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <Circle cx={12} cy={10} r={2.4} />
    </Line>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Circle cx={12} cy={8.5} r={3.5} />
      <Path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />
    </Line>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M12 4a6 6 0 0 0-6 6v4l-1.5 3h15L18 14v-4a6 6 0 0 0-6-6z M10 19.5a2 2 0 0 0 4 0" />
    </Line>
  );
}

export function EyeIcon({ off = false, ...props }: IconProps & { off?: boolean }) {
  return (
    <Line {...props}>
      <Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <Circle cx={12} cy={12} r={2.8} />
      {off ? <Path d="M4 4l16 16" /> : null}
    </Line>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M5 12.5l4.5 4.5L19 7.5" />
    </Line>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Line {...props}>
      <Path d="M12 4v11 M8 8l4-4 4 4 M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </Line>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Line {...props} flipInRtl>
      <Path d="M19 12H5 M11 6l-6 6 6 6" />
    </Line>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Line {...props} flipInRtl>
      <Path d="M9 5l7 7-7 7" />
    </Line>
  );
}

export function DeleteKeyIcon(props: IconProps) {
  return (
    <Line {...props} flipInRtl>
      <Path d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6z M12 10l4 4 M16 10l-4 4" />
    </Line>
  );
}

const primitive = {
  white: '#FFFFFF',
  black: '#000000',
  coral: '#FF5043',
  coralDark: '#E03D31',
  gray100: '#F5F7FA',
  gray200: '#E6E9EF',
  gray400: '#9AA4B2',
  gray700: '#3E4C59',
  success: '#1F9D55',
  error: '#D64545',
  warning: '#F5A623',
};

export type Scheme = 'light' | 'dark';

// Dark glass: black canvas, frosted glass cards, white and dimmed text.
const dark = {
  canvas: '#000000',
  // Opaque raised surface for sheets and dialogs, where glass would show through.
  surface: '#16161C',
  glass: 'rgba(255,255,255,0.06)',
  glassRaised: 'rgba(255,255,255,0.09)',
  glassBorder: 'rgba(255,255,255,0.1)',
  glassBorderStrong: 'rgba(255,255,255,0.18)',
  divider: 'rgba(255,255,255,0.08)',
  text: '#FFFFFF',
  textDim: 'rgba(255,255,255,0.6)',
  textFaint: 'rgba(255,255,255,0.4)',
  // The text colour at an opacity, for one-off fills, borders and rings.
  ink: (alpha: number) => `rgba(255,255,255,${alpha})`,
  // High-contrast fill (the white pill button) and the text drawn on it.
  solid: '#FFFFFF',
  onSolid: '#000000',
  accent: '#FF5043',
  accentText: '#FF8A7A',
  accentSoft: 'rgba(255,80,67,0.18)',
  accentBorder: 'rgba(255,80,67,0.3)',
  incoming: '#34C77B',
  incomingSoft: 'rgba(52,199,123,0.18)',
  warning: '#F5A623',
  warningSoft: 'rgba(245,166,35,0.18)',
  error: '#FF5C5C',
  errorSoft: 'rgba(255,92,92,0.16)',
};

export type Palette = typeof dark;

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

// The ink opacity on white with the same contrast as white at `alpha` on
// black, so a dimmed label reads as clearly in light mode as in dark.
function lightInkAlpha(alpha: number) {
  const contrast = (toLinear(255 * alpha) + 0.05) / 0.05;
  const grey = fromLinear(Math.max(0, 1.05 / contrast - 0.05));
  return Math.round(Math.min(1, Math.max(0, (255 - grey) / (255 - 20))) * 1000) / 1000;
}

// Light: a cool grey canvas with flat white cards and near-black ink.
// Buttons and links use a deep coral (#D9362B), on which white text passes
// 4.5:1; the bright brand coral lives in the coral wallpaper (`wallpaper`).
// Every text colour, green, amber and red included, passes 4.5:1 on the grey.
const light: Palette = {
  canvas: '#F1F1F4',
  surface: '#FFFFFF',
  glass: '#FFFFFF',
  glassRaised: '#F7F7F9',
  glassBorder: '#E6E6EB',
  glassBorderStrong: '#D3D3DA',
  divider: '#EDEDF2',
  text: '#111114',
  textDim: '#5E5E67',
  textFaint: '#6A6A73',
  ink: (alpha: number) => `rgba(17,17,20,${lightInkAlpha(alpha)})`,
  solid: '#D9362B',
  onSolid: '#FFFFFF',
  accent: '#D9362B',
  accentText: '#C4352A',
  accentSoft: 'rgba(217,54,43,0.1)',
  accentBorder: 'rgba(217,54,43,0.3)',
  incoming: '#13803F',
  incomingSoft: 'rgba(19,128,63,0.12)',
  warning: '#9A5B00',
  warningSoft: 'rgba(245,166,35,0.16)',
  error: '#C42B1F',
  errorSoft: 'rgba(196,43,31,0.1)',
};

/**
 * The coral wallpaper behind the light Home header and the Paid screen. It
 * runs from the brand coral into raspberry, deep enough wherever text sits
 * for white text to pass 4.5:1. Buttons and pills drawn on it are smoked
 * glass (`glass`, `glassBorder`).
 */
export const wallpaper = {
  top: '#EC4430',
  colors: ['#EC4430', '#CD2F36', '#A3223F'],
  glass: 'rgba(20,17,15,0.2)',
  glassBorder: 'rgba(255,255,255,0.16)',
};

/** Soft fill and strong mark pairs for avatars and widgets in light mode. */
export const tints = {
  coral: { fill: '#FFEAE6', mark: '#C4352A' },
  green: { fill: '#E3F6EA', mark: '#13803F' },
  blue: { fill: '#E8EFFF', mark: '#2F5BD3' },
  amber: { fill: '#FFF1D9', mark: '#9A5B00' },
  grey: { fill: '#EEEEF2', mark: '#55555E' },
};
export type Tint = (typeof tints)[keyof typeof tints];

function buildColors(ui: Palette, scheme: Scheme) {
  const isDark = scheme === 'dark';
  return {
    primitive,

    // The screens' palette for the current scheme.
    ui,

    background: {
      primary: ui.canvas,
      secondary: isDark ? '#0B0B0F' : '#FFFFFF',
      tertiary: ui.glass,
      gradient: [primitive.coral, '#FF7B6B'],
    },
    text: {
      primary: ui.text,
      secondary: ui.textDim,
      tertiary: ui.textFaint,
      inverse: primitive.white,
      muted: ui.textFaint,
    },
    border: {
      light: ui.divider,
      medium: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(20,17,15,0.12)',
      dark: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(20,17,15,0.4)',
      default: ui.glassBorder,
    },
    // Light buttons use the deep coral, which white text reads on.
    action: {
      primary: isDark ? primitive.coral : ui.accent,
      primaryText: primitive.white,
    },
    status: {
      success: primitive.success,
      error: primitive.error,
      warning: primitive.warning,
    },

    // "Hero" palette for the cinematic auth screens.
    hero: isDark
      ? {
          canvas: '#0B0B0F',
          surface: '#16161C',
          surfaceRaised: '#1E1E26',
          text: '#FFFFFF',
          textSecondary: 'rgba(255, 255, 255, 0.64)',
          textTertiary: 'rgba(255, 255, 255, 0.40)',
          border: 'rgba(255, 255, 255, 0.12)',
          borderStrong: 'rgba(255, 255, 255, 0.24)',
          glow: 'rgba(255, 80, 67, 0.32)',
          pill: 'rgba(255, 255, 255, 0.10)',
          accentGradient: ['#FF5043', '#FF8A7A', '#FFB3AA'],
        }
      : {
          canvas: '#FFFFFF',
          surface: '#F6F5F3',
          surfaceRaised: '#EFEDEA',
          text: '#14110F',
          textSecondary: 'rgba(20, 17, 15, 0.64)',
          textTertiary: 'rgba(20, 17, 15, 0.50)',
          border: 'rgba(20, 17, 15, 0.12)',
          borderStrong: 'rgba(20, 17, 15, 0.24)',
          glow: 'rgba(255, 80, 67, 0.24)',
          pill: 'rgba(20, 17, 15, 0.06)',
          accentGradient: ['#FF5043', '#FF8A7A', '#FFB3AA'],
        },

    // Backward-compatible aliases. In light, coral text and the gradient
    // buttons use the deep coral, so white and coral text both stay readable.
    primary: isDark ? primitive.coral : ui.accent,
    primaryDark: isDark ? primitive.coralDark : '#B82D23',
    primaryLight: ui.accentSoft,
    primaryGradientStart: isDark ? primitive.coral : ui.accent,
    primaryGradientEnd: isDark ? '#FF7B6B' : '#C42F25',
    success: ui.incoming,
    successDark: isDark ? '#178244' : '#106B39',
    successLight: ui.incomingSoft,
    warning: ui.warning,
    warningLight: ui.warningSoft,
    error: ui.error,
    errorLight: ui.errorSoft,
    overlay: 'rgba(0, 0, 0, 0.6)',
    overlayLight: 'rgba(0, 0, 0, 0.3)',
  };
}

export type Colors = ReturnType<typeof buildColors>;

export const palettes: Record<Scheme, Colors> = {
  dark: buildColors(dark, 'dark'),
  light: buildColors(light, 'light'),
};

export const gradients = {
  primary: {
    colors: ['#FF5043', '#FF7B6B'],
    start: { x: 0, y: 0.5 },
    end: { x: 1, y: 0.5 },
  },
  heroAccent: {
    colors: ['#FF5043', '#FF8A7A', '#FFB3AA'],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },
};

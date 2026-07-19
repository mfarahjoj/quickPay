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

export const colors = {
  primitive,

  // Semantic tokens — dark-glass theme.
  background: {
    primary: '#000000',
    secondary: '#0B0B0F',
    tertiary: 'rgba(255,255,255,0.06)',
    gradient: [primitive.coral, '#FF7B6B'],
  },
  text: {
    primary: '#FFFFFF',
    secondary: 'rgba(255,255,255,0.6)',
    tertiary: 'rgba(255,255,255,0.4)',
    inverse: primitive.white,
    muted: 'rgba(255,255,255,0.4)',
  },
  border: {
    light: 'rgba(255,255,255,0.08)',
    medium: 'rgba(255,255,255,0.12)',
    dark: 'rgba(255,255,255,0.4)',
    default: 'rgba(255,255,255,0.1)',
  },
  action: {
    primary: primitive.coral,
    primaryText: primitive.white,
  },
  status: {
    success: primitive.success,
    error: primitive.error,
    warning: primitive.warning,
  },

  // Dark "hero" palette for cinematic auth screens.
  hero: {
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
  },

  // Dark-glass palette — black canvas + frosted glass cards + white/dim text.
  dark: {
    canvas: '#000000',
    glass: 'rgba(255,255,255,0.06)',
    glassRaised: 'rgba(255,255,255,0.09)',
    glassBorder: 'rgba(255,255,255,0.1)',
    glassBorderStrong: 'rgba(255,255,255,0.18)',
    divider: 'rgba(255,255,255,0.08)',
    text: '#FFFFFF',
    textDim: 'rgba(255,255,255,0.6)',
    textFaint: 'rgba(255,255,255,0.4)',
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
  },

  // Warm cream palette for onboarding / light screens.
  cream: {
    canvas: '#FBFAF8',
    surface: '#FFFFFF',
    text: '#14110F',
    textDim: '#6B6560',
    textFaint: '#A89F98',
    accent: '#FF5043',
    accentSoft: 'rgba(255,80,67,0.10)',
    border: 'rgba(20,17,15,0.10)',
    borderStrong: 'rgba(20,17,15,0.18)',
  },

  // Backward-compatible aliases.
  primary: primitive.coral,
  primaryDark: primitive.coralDark,
  primaryLight: 'rgba(255,80,67,0.18)',
  primaryGradientStart: primitive.coral,
  primaryGradientEnd: '#FF7B6B',
  success: '#34C77B',
  successDark: '#178244',
  successLight: 'rgba(52,199,123,0.18)',
  warning: primitive.warning,
  warningLight: 'rgba(245,166,35,0.18)',
  error: '#FF5C5C',
  errorLight: 'rgba(255,92,92,0.16)',
  overlay: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
};

export const gradients = {
  primary: {
    colors: ['#FF5043', '#FF7B6B'],
    start: { x: 0, y: 0.5 },
    end: { x: 1, y: 0.5 },
  },
  heroAccent: {
    colors: colors.hero.accentGradient,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },
};

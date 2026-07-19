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

  // Semantic tokens
  background: {
    primary: primitive.white,
    secondary: primitive.gray100,
    tertiary: primitive.gray200,
    gradient: [primitive.coral, '#FF7B6B'],
  },
  text: {
    primary: primitive.black,
    secondary: primitive.gray700,
    tertiary: primitive.gray400,
    inverse: primitive.white,
    muted: primitive.gray400,
  },
  border: {
    light: primitive.gray100,
    medium: primitive.gray200,
    dark: primitive.gray400,
    default: primitive.gray200,
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

  // Dark "hero" palette for cinematic auth screens (splash, onboarding).
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

  // Backward-compatible aliases used across existing screens.
  primary: primitive.coral,
  primaryDark: primitive.coralDark,
  primaryLight: 'rgba(255,80,67,0.18)',
  primaryGradientStart: primitive.coral,
  primaryGradientEnd: '#FF7B6B',
  success: primitive.success,
  successDark: '#178244',
  successLight: '#E9F8EF',
  warning: primitive.warning,
  warningLight: '#FFF6E8',
  error: primitive.error,
  errorLight: '#FDEBEC',
  overlay: 'rgba(0, 0, 0, 0.5)',
  overlayLight: 'rgba(0, 0, 0, 0.2)',
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

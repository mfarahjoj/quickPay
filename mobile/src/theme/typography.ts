export const typography = {
  // Apple-style display scale: large, tight-tracked headlines
  displayXL: {
    fontSize: 40,
    fontWeight: '700' as const,
    lineHeight: 46,
    letterSpacing: -1.2,
  },
  displayL: {
    fontSize: 34,
    fontWeight: '700' as const,
    lineHeight: 40,
    letterSpacing: -0.8,
  },

  // Figma text styles
  display: {
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 40,
    letterSpacing: -0.6,
  },

  // Headings
  h1: {
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  h2: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 28,
  },

  // Body
  body: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  bodyLarge: {
    fontSize: 16,
    fontWeight: '500' as const,
    lineHeight: 24,
  },
  bodySemibold: {
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 20,
  },

  // Caption
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  captionBold: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
  },

  // Legacy aliases
  h3: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
  overline: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  balanceNumber: {
    fontSize: 36,
    fontWeight: '700' as const,
    lineHeight: 44,
    letterSpacing: -0.4,
  },
  tabularAmount: {
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 20,
    fontVariant: ['tabular-nums'] as const,
  },
};

import { colors } from './colors';
import { typography } from './typography';
import { spacing, borderRadius, shadows } from './spacing';

// Re-export for convenience
export { colors, gradients } from './colors';
export { typography } from './typography';
export { spacing, borderRadius, shadows, animation } from './spacing';

// Export complete theme object
export const theme = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
};

export type Theme = typeof theme;

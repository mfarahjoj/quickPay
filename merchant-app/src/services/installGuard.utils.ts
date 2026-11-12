/**
 * Telling a fresh install from a launch or an update (installGuard.ts).
 * Pure, so it's unit-tested without React Native.
 */
export const INSTALL_MARKER_KEY = '@zapp_install_marker';

export type InstallKind = 'known' | 'updated' | 'fresh';

/**
 * [markerPresent]: this install has run the guard before. [otherKeys]: how
 * many other keys local storage holds — an install from before the guard
 * existed has some (language, setup flags), a brand-new one has none.
 */
export function installKind(markerPresent: boolean, otherKeys: number): InstallKind {
  if (markerPresent) return 'known';
  return otherKeys > 0 ? 'updated' : 'fresh';
}

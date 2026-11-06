import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palettes, type Colors, type Scheme } from './colors';

export type AppearancePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = '@quickpay_appearance';

function isPreference(value: string | null): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

interface ThemeValue {
  scheme: Scheme;
  colors: Colors;
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => void;
}

const ThemeContext = createContext<ThemeValue>({
  scheme: 'dark',
  colors: palettes.dark,
  preference: 'system',
  setPreference: () => undefined,
});

/**
 * Light or dark: the phone's setting unless the customer picked one under
 * Profile → Appearance. Alerts and the keyboard follow the same choice.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  // null until the saved choice is read.
  const [preference, setPreferenceState] = useState<AppearancePreference | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => setPreferenceState(isPreference(stored) ? stored : 'system'))
      .catch(() => setPreferenceState('system'));
  }, []);

  useEffect(() => {
    if (preference) {
      Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
    }
  }, [preference]);

  const setPreference = useCallback((next: AppearancePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const scheme: Scheme =
    preference === 'light' || preference === 'dark'
      ? preference
      : system === 'light'
        ? 'light'
        : 'dark';

  const value = useMemo(
    () => ({ scheme, colors: palettes[scheme], preference: preference ?? 'system', setPreference }),
    [scheme, preference, setPreference],
  );

  // Draw nothing until the saved choice is known, so a customer who picked
  // dark on a light phone doesn't get a light first frame.
  if (!preference) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

export function useColors(): Colors {
  return useContext(ThemeContext).colors;
}

/**
 * For style sheets that use theme colours:
 * `const useStyles = makeStyles((colors) => StyleSheet.create({...}))`.
 * The hook gives the sheet for the current scheme; each is built once.
 */
export function makeStyles<T>(factory: (colors: Colors) => T): () => T {
  const sheets: Partial<Record<Scheme, T>> = {};
  return function useStyles() {
    const { scheme, colors } = useContext(ThemeContext);
    return (sheets[scheme] ??= factory(colors));
  };
}

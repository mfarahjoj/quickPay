import { useEffect, useState } from 'react';
import { firestore } from '../services/firebase.config';

/**
 * Whether shops can link a counter display, from the public config/app_client
 * doc: `{ merchant: { counterDisplay: true, counterDisplayUrl: "https://…" } }`.
 * Anything else is off, so this build never shows a screen whose backend
 * isn't deployed yet.
 */
export interface CounterDisplayConfig {
  on: boolean;
  /** Where to open the display on the tablet, shown on the setup screen. */
  url: string | null;
}

export function counterDisplayConfig(appClient: unknown): CounterDisplayConfig {
  const merchant = (appClient as { merchant?: { counterDisplay?: unknown; counterDisplayUrl?: unknown } } | undefined)
    ?.merchant;
  const url = merchant?.counterDisplayUrl;
  return {
    on: merchant?.counterDisplay === true,
    url: typeof url === 'string' && /^https:\/\//.test(url) ? url : null,
  };
}

export function useCounterDisplayOn(): CounterDisplayConfig {
  const [config, setConfig] = useState<CounterDisplayConfig>({ on: false, url: null });
  useEffect(() => {
    let cancelled = false;
    firestore()
      .collection('config')
      .doc('app_client')
      .get()
      .then((snap) => {
        if (!cancelled) setConfig(counterDisplayConfig(snap.data()));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}

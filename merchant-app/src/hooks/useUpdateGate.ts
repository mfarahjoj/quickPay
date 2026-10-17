import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { firestore } from '../services/firebase.config';
import { APP_COMPAT_LEVEL } from '../config/constants';

/** This app's entry in `config/app_client`; the customer app reads `customer`. */
const APP_KEY = 'merchant';

/** Store and TestFlight links only — the doc is public, but a link is still a link. */
const UPDATE_URL = /^(https:\/\/|itms-apps:\/\/|itms-beta:\/\/|market:\/\/)/;

export interface UpdateGate {
  required: boolean;
  /** Where "Update" goes, for this platform. Absent when none is configured. */
  updateUrl?: string;
}

/**
 * Whether this build is too old to keep running.
 *
 * Reads the public `config/app_client` doc (firestore.rules):
 *
 *   { merchant: { minCompatLevel: 2, updateUrl: { ios: "https://apps.apple.com/…", android: "…" } } }
 *
 * and compares it with APP_COMPAT_LEVEL. Checked at launch and whenever the
 * app comes back to the foreground. Fails open: offline, a missing doc or a
 * malformed one never locks anyone out of their money — only a deliberate
 * number in Firestore does.
 */
export function useUpdateGate(): UpdateGate {
  const [gate, setGate] = useState<UpdateGate>({ required: false });

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      firestore()
        .collection('config')
        .doc('app_client')
        .get()
        .then((snap) => {
          if (cancelled) return;
          const entry = snap.data()?.[APP_KEY];
          const min = entry?.minCompatLevel;
          const url = entry?.updateUrl?.[Platform.OS];
          setGate({
            required: typeof min === 'number' && min > APP_COMPAT_LEVEL,
            ...(typeof url === 'string' && UPDATE_URL.test(url) ? { updateUrl: url } : {}),
          });
        })
        .catch(() => undefined);
    };

    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return gate;
}

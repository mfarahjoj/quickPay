import { useEffect, useState } from 'react';
import { firestore } from '../services/firebase.config';

/**
 * Whether agents can buy float with Zaad, from the public config/app_client
 * doc: `{ merchant: { zaadFloat: true } }`. Anything else is off, so a build
 * that ships before the collection number and listener phone are live never
 * leads anyone to a screen that can't finish.
 */
export function zaadFloatOn(appClient: unknown): boolean {
  return (appClient as { merchant?: { zaadFloat?: unknown } } | undefined)?.merchant?.zaadFloat === true;
}

export function useZaadFloatOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    firestore()
      .collection('config')
      .doc('app_client')
      .get()
      .then((snap) => {
        if (!cancelled) setOn(zaadFloatOn(snap.data()));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}

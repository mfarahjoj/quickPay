import { useEffect, useState } from 'react';
import { firestore } from '../services/firebase.config';
import { zaadTopupsOn } from '../services/mobileMoney.utils';

/** The last answer, so a screen opened again doesn't wait for it. */
let lastKnown = false;

/**
 * Whether Zaad top-ups are open: `customer.zaadTopups` in the public
 * config/app_client doc (firestore.rules), switched on once the Zaad
 * functions are live. Off until the doc says otherwise, and off when it
 * can't be read the first time.
 */
export function useZaadTopups(): boolean {
  const [on, setOn] = useState(lastKnown);

  useEffect(() => {
    let cancelled = false;
    firestore()
      .collection('config')
      .doc('app_client')
      .get()
      .then((snap) => {
        lastKnown = zaadTopupsOn(snap.data());
        if (!cancelled) setOn(lastKnown);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return on;
}

import { useEffect, useState } from 'react';
import { firestore } from '../services/firebase.config';

/**
 * When this account is due to be deleted (requestAccountDeletion), or null.
 * undefined while it's still being read. Signing back in during the wait
 * shows the choice to keep the account (cancelAccountDeletion).
 */
export function useDeletionPending(uid: string | undefined): Date | null | undefined {
  const [dueAt, setDueAt] = useState<Date | null | undefined>(undefined);
  useEffect(() => {
    if (!uid) {
      setDueAt(null);
      return;
    }
    setDueAt(undefined);
    return firestore()
      .collection('users')
      .doc(uid)
      .onSnapshot(
        (snap) => {
          const d = snap.data();
          const due = d?.deletionRequestedAt && d?.deleted !== true ? d?.deletionDueAt?.toDate?.() : null;
          setDueAt(due ?? null);
        },
        // Unreadable: don't hold the app up over it.
        () => setDueAt(null),
      );
  }, [uid]);
  return dueAt;
}

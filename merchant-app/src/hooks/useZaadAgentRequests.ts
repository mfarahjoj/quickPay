/**
 * Everything an agent's Zaad top-ups need on screen (D32): the offers ringing
 * now, the requests they've taken, grouped by what the agent must do, and
 * the float held for them.
 */

import { useEffect, useMemo, useState } from 'react';
import { watchMyZaadOffers, watchMyZaadTopups, type ZaadTopupRow } from '../services/zaadAgent.service';

export interface ZaadAgentRequests {
  /** Ringing now, the one ending soonest first. */
  offers: ZaadTopupRow[];
  /** Customer says sent: check your Zaad. */
  toCheck: ZaadTopupRow[];
  /** Accepted: waiting for the customer to send. */
  waiting: ZaadTopupRow[];
  /** Declined and open to dispute, or disputed: Zapp is or may be reviewing. */
  inReview: ZaadTopupRow[];
  /** Ended today. */
  doneToday: ZaadTopupRow[];
  /** Ended before today. */
  earlier: ZaadTopupRow[];
  /** Float set aside for requests not yet settled, in cents. */
  heldCents: number;
  loaded: boolean;
}

const HELD = new Set(['accepted', 'customer_sent', 'declined', 'disputed']);

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function groupZaadRequests(offers: ZaadTopupRow[], mine: ZaadTopupRow[], todayMs = startOfToday()): Omit<ZaadAgentRequests, 'loaded'> {
  const by = (s: string) => mine.filter((r) => r.status === s);
  const ended = mine.filter((r) => !HELD.has(r.status) && r.status !== 'offered');
  const endedAt = (r: ZaadTopupRow) => r.updatedAt?.toMillis() ?? r.createdAt?.toMillis() ?? 0;
  return {
    offers,
    toCheck: by('customer_sent'),
    waiting: by('accepted'),
    inReview: [...by('declined'), ...by('disputed')],
    doneToday: ended.filter((r) => endedAt(r) >= todayMs),
    earlier: ended.filter((r) => endedAt(r) < todayMs),
    heldCents: mine.filter((r) => HELD.has(r.status)).reduce((sum, r) => sum + r.amount, 0),
  };
}

export function useZaadAgentRequests(uid: string | undefined): ZaadAgentRequests {
  const [offers, setOffers] = useState<ZaadTopupRow[]>([]);
  const [mine, setMine] = useState<ZaadTopupRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const stopOffers = watchMyZaadOffers(uid, setOffers);
    const stopMine = watchMyZaadTopups(uid, (list) => {
      setMine(list);
      setLoaded(true);
    });
    return () => {
      stopOffers();
      stopMine();
    };
  }, [uid]);

  return useMemo(() => ({ ...groupZaadRequests(offers, mine), loaded }), [offers, mine, loaded]);
}

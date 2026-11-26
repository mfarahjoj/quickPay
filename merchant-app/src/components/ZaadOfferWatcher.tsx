/**
 * For agents taking Zaad top-ups: while they're online, check in every
 * minute (an agent whose app stops checking in drops out of offers), and
 * open the offer as a job card the moment a new request rings on them,
 * wherever they are in the app. Several can ring at once (D32): the screen
 * shows them as a queue, so this opens it once, not once per offer.
 *
 * Renders nothing. Mounted once inside the signed-in navigator.
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { getZaadStatus, watchMyZaadOffers, watchZaadAgent, type ZaadAgentDoc } from '../services/zaadAgent.service';

const HEARTBEAT_MS = 60_000;

interface Props {
  /** Whether the Zaad top-ups screen is already showing. */
  isShowing: () => boolean;
  /** Open it on this offer, so the agent lands on the job card, not the list. */
  open: (requestId: string) => void;
}

export function ZaadOfferWatcher({ isShowing, open }: Props) {
  const { user } = useAuth();
  const uid = user?.uid;
  const agent = useRef<ZaadAgentDoc | null>(null);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;
    return watchZaadAgent(uid, (doc) => {
      agent.current = doc;
    });
  }, [uid]);

  // Offers ringing on this agent: open the screen when one we haven't seen arrives.
  useEffect(() => {
    if (!uid) return;
    return watchMyZaadOffers(uid, (offers) => {
      const fresh = offers.filter((o) => !seen.current.has(o.id));
      fresh.forEach((o) => seen.current.add(o.id));
      if (fresh.length > 0 && !isShowing()) open(fresh[0].id);
    });
  }, [uid, isShowing, open]);

  // The heartbeat, while online and the app is in front.
  useEffect(() => {
    if (!uid) return;
    const beat = () => {
      if (agent.current?.online && AppState.currentState === 'active') getZaadStatus().catch(() => undefined);
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && beat());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [uid]);

  return null;
}

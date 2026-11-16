/**
 * For agents taking Zaad top-ups: while they're online, check in every
 * minute (an agent whose app stops checking in drops out of offers), and
 * open the Zaad top-ups screen the moment a request rings on them,
 * wherever they are in the app.
 *
 * Renders nothing. Mounted once inside the signed-in navigator.
 */

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { getZaadStatus, watchZaadAgent, watchZaadTopup, type ZaadAgentDoc } from '../services/zaadAgent.service';

const HEARTBEAT_MS = 60_000;

interface Props {
  /** Whether the Zaad top-ups screen is already showing. */
  isShowing: () => boolean;
  /** Open it. */
  open: () => void;
}

export function ZaadOfferWatcher({ isShowing, open }: Props) {
  const { user } = useAuth();
  const uid = user?.uid;
  const agent = useRef<ZaadAgentDoc | null>(null);
  const shown = useRef<string | null>(null);

  // Which request, if any, is ringing on this agent.
  useEffect(() => {
    if (!uid) return;
    let stopTopup: (() => void) | undefined;
    const stopAgent = watchZaadAgent(uid, (doc) => {
      agent.current = doc;
      stopTopup?.();
      stopTopup = undefined;
      const id = doc?.openRequestId;
      if (!id) return;
      stopTopup = watchZaadTopup(id, (req) => {
        if (req?.status !== 'offered' || req.offeredTo !== uid || shown.current === id) return;
        shown.current = id;
        if (!isShowing()) open();
      });
    });
    return () => {
      stopTopup?.();
      stopAgent();
    };
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

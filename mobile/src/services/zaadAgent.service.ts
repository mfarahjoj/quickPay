/**
 * Zaad top-ups through agents (functions/src/zaadAgent/customer.ts).
 *
 * The customer asks for an amount; Zapp finds an online agent; the customer
 * pays the agent's Zaad and enters the Zaad transaction ID; the agent
 * confirms and their float tops up the wallet. The request lives in
 * `zaadAgentTopups/{id}`, which the customer may read.
 */

import firestore from '@react-native-firebase/firestore';
import { functions } from './firebase.config';

export type ZaadAgentTopupStatus =
  | 'offered'
  | 'no_agent'
  | 'accepted'
  | 'customer_sent'
  | 'declined'
  | 'disputed'
  | 'completed'
  | 'released'
  | 'expired'
  | 'cancelled';

type Stamp = { toMillis(): number };

export interface ZaadAgentTopupDoc {
  customerId: string;
  /** US cents. */
  amount: number;
  status: ZaadAgentTopupStatus;
  agentName?: string;
  agentReceiveMsisdn?: string;
  dialCode?: string | null;
  sendBy?: Stamp;
  customerZaadTxnId?: string;
  confirmBy?: Stamp;
  agentAnswer?: 'received' | 'not_received' | 'different_amount';
  disputeUntil?: Stamp;
  resolution?: { outcome: 'customer' | 'agent' };
}

async function call<T>(name: string, payload: unknown): Promise<T> {
  const res = await functions().httpsCallable(name)(payload);
  return (res.data as { data: T }).data;
}

export const requestZaadAgentTopup = (amountCents: number) =>
  call<{ requestId: string; status: ZaadAgentTopupStatus }>('customerRequestZaadAgentTopup', { amount: amountCents });

export const cancelZaadAgentTopup = (requestId: string) => call<unknown>('customerCancelZaadTopup', { requestId });

export const markZaadSent = (requestId: string, zaadTxnId: string) =>
  call<{ confirmBy: string }>('customerMarkZaadSent', { requestId, zaadTxnId });

export const disputeZaadAgentTopup = (requestId: string, reason: string) =>
  call<unknown>('customerDisputeZaadTopup', { requestId, reason });

export function watchZaadAgentTopup(id: string, onChange: (doc: ZaadAgentTopupDoc | null) => void): () => void {
  return firestore()
    .collection('zaadAgentTopups')
    .doc(id)
    .onSnapshot(
      (snap) => onChange((snap.data() as ZaadAgentTopupDoc | undefined) ?? null),
      () => onChange(null),
    );
}

/** A Zaad transaction ID as typed: spaces dropped, upper case; null if it can't be one. Mirrors the server. */
export function normaliseTxnId(raw: string): string | null {
  const t = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9_-]{4,64}$/.test(t) ? t : null;
}

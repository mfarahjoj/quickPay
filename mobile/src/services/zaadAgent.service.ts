/**
 * Zaad top-ups through agents (functions/src/zaadAgent/customer.ts).
 *
 * The customer asks for an amount; Zapp finds an online agent and makes a
 * reference (ZP-…); the customer pays the agent's Zaad and taps "I've sent
 * it"; the agent
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
  /** Zapp's reference, e.g. "ZP-4F7K2" (D31). Missing on requests made before it. */
  reference?: string;
  /** "in_person": the agent scanned the customer's code. Missing: remote. */
  meeting?: 'in_person' | 'remote';
  agentName?: string;
  agentReceiveMsisdn?: string;
  dialCode?: string | null;
  /** While the request rings on agents: when it stops, if none has accepted. */
  offerExpiresAt?: Stamp | null;
  sendBy?: Stamp;
  customerZaadTxnId?: string;
  confirmBy?: Stamp;
  agentAnswer?: 'received' | 'not_received' | 'different_amount';
  disputeUntil?: Stamp;
  /** "customer": you disputed an agent's "not received"; "timeout": the agent didn't answer in time. */
  disputedBy?: 'customer' | 'timeout';
  /** What the customer typed when they disputed. */
  disputeReason?: string;
  resolution?: { outcome: 'customer' | 'agent' };
}

async function call<T>(name: string, payload: unknown): Promise<T> {
  const res = await functions().httpsCallable(name)(payload);
  return (res.data as { data: T }).data;
}

export const requestZaadAgentTopup = (amountCents: number) =>
  call<{ requestId: string; status: ZaadAgentTopupStatus; reference?: string }>('customerRequestZaadAgentTopup', { amount: amountCents });

export const cancelZaadAgentTopup = (requestId: string) => call<unknown>('customerCancelZaadTopup', { requestId });

/** One tap (D31): Zapp's reference identifies the top-up, so nothing is typed. */
export const markZaadSent = (requestId: string) => call<{ confirmBy: string }>('customerMarkZaadSent', { requestId });

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

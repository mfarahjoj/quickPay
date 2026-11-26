/**
 * Zaad top-ups through agents (functions/src/zaadAgent/agent.ts).
 *
 * The customer pays this agent's Zaad number and the agent's float credits
 * their wallet. Zapp's reference (ZP-…, D31) names the top-up on both sides. Requests live in `zaadAgentTopups/{id}`, which the agent may
 * read while it rings on them and once they accept; `zaad_agents/{uid}` says
 * which request that is.
 */

import { firestore, functions } from './firebase.config';

export type ZaadTopupStatus =
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

export interface ZaadTopupDoc {
  customerFirstName: string;
  /** Zapp's reference, e.g. "ZP-4F7K2" (D31). Missing on requests made before it. */
  reference?: string;
  /** US cents. */
  amount: number;
  status: ZaadTopupStatus;
  /** "in_person": the agent scanned the customer and chose Zaad. Missing: remote. */
  meeting?: 'in_person' | 'remote';
  /** Every agent this is ringing on now; the first to accept wins. Missing on older requests: read offeredTo. */
  offeredToIds?: string[];
  offeredTo: string | null;
  /** What the agent earns if this completes, in cents. */
  agentCommissionCents?: number;
  offerExpiresAt: { toMillis(): number } | null;
  agentId: string | null;
  agentReceiveMsisdn?: string;
  allowedSenders?: string[];
  sendBy?: { toMillis(): number };
  customerZaadTxnId?: string;
  confirmBy?: { toMillis(): number };
  createdAt?: { toMillis(): number };
  updatedAt?: { toMillis(): number };
}

/** A request with its id, for lists. */
export type ZaadTopupRow = ZaadTopupDoc & { id: string };

export interface ZaadAgentDoc {
  enabled: boolean;
  online: boolean;
  /** Remote requests ringing or held, oldest first (D32). Missing on older docs. */
  openRequestIds?: string[];
  /** The newest of openRequestIds. */
  openRequestId: string | null;
  receiveMsisdn: string | null;
}

export interface ZaadAgentStatus {
  enabled: boolean;
  online: boolean;
  receiveNumber: string | null;
  pausedUntil: string | null;
  openRequestId: string | null;
  /** Remote requests open now, and the most allowed at once (D32). Missing from older servers. */
  openCount?: number;
  maxOpen?: number;
  floatCents: number;
  floatLowCents: number;
  open: boolean;
}

async function call<T>(name: string, payload?: unknown): Promise<T> {
  const res = await functions().httpsCallable(name)(payload ?? {});
  return (res.data as { data: T }).data;
}

/** Also the heartbeat: an online agent who stops calling this gets no offers. */
export const getZaadStatus = () => call<ZaadAgentStatus>('agentGetZaadStatus');

export const setZaadOnline = (online: boolean) => call<{ online: boolean }>('agentSetZaadOnline', { online });

/**
 * In person: the customer whose code was just scanned pays by Zaad. Holds the
 * agent's float and returns the Zaad request to follow (D19).
 */
export const startZaadInPerson = (target: { otpCode: string; requestId?: string; customerPhone?: string; expectedAmount: number }) =>
  call<{ requestId: string; reference: string | null; amount: number; customerName: string; allowedSenders: string[]; sendBy: string }>(
    'agentStartZaadInPerson',
    target,
  );

export const answerZaadOffer = (requestId: string, accept: boolean) =>
  call<unknown>('agentAnswerZaadOffer', { requestId, accept });

export const confirmZaadTopup = (
  requestId: string,
  answer: 'received' | 'not_received' | 'different_amount',
  expectedAmount: number,
  agentPin?: string,
  /** Optional, on "received": Zaad's ID from the agent's own text (D31). */
  zaadTxnId?: string,
) => call<{ status: ZaadTopupStatus; commissionCents?: number }>('agentConfirmZaadTopup', {
  requestId,
  answer,
  expectedAmount,
  ...(agentPin ? { agentPin } : {}),
  ...(zaadTxnId ? { zaadTxnId } : {}),
});

/** A Zaad transaction ID as typed: spaces dropped, upper case; null if it can't be one. Mirrors the server. */
export function normaliseTxnId(raw: string): string | null {
  const t = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9_-]{4,64}$/.test(t) ? t : null;
}

export function watchZaadAgent(uid: string, onChange: (doc: ZaadAgentDoc | null) => void): () => void {
  return firestore()
    .collection('zaad_agents')
    .doc(uid)
    .onSnapshot(
      (snap) => onChange((snap.data() as ZaadAgentDoc | undefined) ?? null),
      () => onChange(null),
    );
}

export function watchZaadTopup(id: string, onChange: (doc: ZaadTopupDoc | null) => void): () => void {
  return firestore()
    .collection('zaadAgentTopups')
    .doc(id)
    .onSnapshot(
      (snap) => onChange((snap.data() as ZaadTopupDoc | undefined) ?? null),
      () => onChange(null),
    );
}

const rows = (snap: { docs: { id: string; data(): unknown }[] }): ZaadTopupRow[] =>
  snap.docs.map((d) => ({ ...(d.data() as ZaadTopupDoc), id: d.id }));

/**
 * The agent's own requests once taken, newest first (D32): what they must
 * check, what's waiting, what's in review, and history. Rules let an agent
 * read only requests where they are the agent or the one being offered.
 */
export function watchMyZaadTopups(uid: string, onChange: (list: ZaadTopupRow[]) => void, limit = 50): () => void {
  return firestore()
    .collection('zaadAgentTopups')
    .where('agentId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .onSnapshot(
      (snap) => onChange(rows(snap)),
      () => onChange([]),
    );
}

/** Offers ringing on this agent now, each with its own timer (D32). Each rings on several agents at once. */
export function watchMyZaadOffers(uid: string, onChange: (list: ZaadTopupRow[]) => void): () => void {
  return firestore()
    .collection('zaadAgentTopups')
    .where('offeredToIds', 'array-contains', uid)
    .where('status', '==', 'offered')
    .onSnapshot(
      (snap) =>
        onChange(rows(snap).sort((a, b) => (a.offerExpiresAt?.toMillis() ?? 0) - (b.offerExpiresAt?.toMillis() ?? 0))),
      () => onChange([]),
    );
}

/** "+252634123456" → "063 ••• 3456". */
export function maskMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\D/g, '');
  if (digits.startsWith('252') && digits.length >= 12) return `0${digits.slice(3, 5)} ••• ${digits.slice(-4)}`;
  return `••• ${digits.slice(-4)}`;
}

/** The server words a wrong PIN on this call as "Wrong PIN". */
export function isWrongZaadPin(error: any): boolean {
  return error?.code === 'functions/permission-denied' && /wrong pin|invalid pin/i.test(error?.message ?? '');
}

/** Whether this request is ringing on [uid] now. */
export const ringsOn = (req: Pick<ZaadTopupDoc, 'offeredToIds' | 'offeredTo'>, uid: string): boolean =>
  (req.offeredToIds ?? (req.offeredTo ? [req.offeredTo] : [])).includes(uid);

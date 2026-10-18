/**
 * Disputes: raise, follow and answer a claim that a transaction went wrong.
 *
 * Writes go through callables (`functions/src/disputes/`). The app reads its
 * own disputes straight from Firestore — rules let only the person who raised
 * one, and the person it's against, read it — so the thread updates live.
 */

import { useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import { functions } from './firebase.config';
import { useAuth } from '../hooks/useAuth';
import { logger } from '../utils/logger';

export type DisputeKind =
  | 'refund_requested'
  | 'not_received'
  | 'wrong_amount'
  | 'unauthorised'
  | 'refund_not_given'
  | 'cash_not_given'
  | 'cash_given_not_credited'
  | 'wrong_recipient'
  | 'other';

export type DisputeStatus = 'open' | 'under_review' | 'awaiting_funds' | 'resolved' | 'withdrawn';

export interface DisputeMessage {
  by: string;
  role: 'raiser' | 'counterparty' | 'ops';
  text: string;
  at: Date;
}

export interface Dispute {
  id: string;
  transactionId?: string;
  agentTopupRequestId?: string;
  kind: DisputeKind;
  status: DisputeStatus;
  raisedBy: string;
  against: string | null;
  /** Cents. */
  amountCents: number;
  messages: DisputeMessage[];
  createdAt: Date;
  respondBy: Date;
  resolveBy: Date;
  owedCents?: number;
  resolution?: {
    outcome: 'upheld' | 'rejected';
    amountCents: number;
    reason: string;
    settledAt?: Date;
  };
}

export interface DisputeTarget {
  transactionId?: string;
  agentTopupRequestId?: string;
}

export interface DisputeOptions {
  allowedKinds: DisputeKind[];
  existingDisputeId: string | null;
  windowOpen: boolean;
  disputeWindowDays: number;
  hasCounterparty: boolean;
  transactionAmountCents: number;
}

export const ACTIVE_STATUSES: DisputeStatus[] = ['open', 'under_review', 'awaiting_funds'];

const toDate = (v: any): Date => v?.toDate?.() ?? (v ? new Date(v) : new Date(0));

function fromDoc(id: string, d: any): Dispute {
  return {
    id,
    transactionId: d.transactionId,
    agentTopupRequestId: d.agentTopupRequestId,
    kind: d.kind,
    status: d.status,
    raisedBy: d.raisedBy,
    against: d.against ?? null,
    amountCents: d.amountCents,
    messages: (d.messages ?? []).map((m: any) => ({ ...m, at: toDate(m.at) })),
    createdAt: toDate(d.createdAt),
    respondBy: toDate(d.respondBy),
    resolveBy: toDate(d.resolveBy),
    owedCents: d.owedCents,
    resolution: d.resolution
      ? {
          outcome: d.resolution.outcome,
          amountCents: d.resolution.amountCents,
          reason: d.resolution.reason,
          settledAt: d.resolution.settledAt ? toDate(d.resolution.settledAt) : undefined,
        }
      : undefined,
  };
}

export async function getDisputeOptions(target: DisputeTarget): Promise<DisputeOptions> {
  const res = await functions().httpsCallable('getDisputeOptions')(target);
  return (res.data as { data: DisputeOptions }).data;
}

export async function openDispute(
  target: DisputeTarget & { kind: DisputeKind; note: string; amountCents?: number }
): Promise<string> {
  const res = await functions().httpsCallable('openDispute')(target);
  return (res.data as { data: { disputeId: string } }).data.disputeId;
}

export async function postDisputeMessage(disputeId: string, text: string): Promise<void> {
  await functions().httpsCallable('postDisputeMessage')({ disputeId, text });
}

export async function withdrawDispute(disputeId: string): Promise<void> {
  await functions().httpsCallable('withdrawDispute')({ disputeId });
}

/** Every dispute the signed-in user raised or is answering, newest first. */
export function useMyDisputes() {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setDisputes([]);
      setLoading(false);
      return;
    }
    return firestore()
      .collection('disputes')
      .where('participants', 'array-contains', user.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .onSnapshot(
        (snap) => {
          setDisputes(snap.docs.map((d) => fromDoc(d.id, d.data())));
          setError(null);
          setLoading(false);
        },
        (err) => {
          logger.error('Disputes listener error:', err);
          setError(err.message);
          setLoading(false);
        }
      );
  }, [user?.uid]);

  return { disputes, loading, error };
}

/** One dispute, live. */
export function useDispute(disputeId: string | undefined) {
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!disputeId) return;
    return firestore()
      .collection('disputes')
      .doc(disputeId)
      .onSnapshot(
        (snap) => {
          setDispute(snap.exists ? fromDoc(snap.id, snap.data()) : null);
          setLoading(false);
        },
        (err) => {
          logger.error('Dispute listener error:', err);
          setLoading(false);
        }
      );
  }, [disputeId]);

  return { dispute, loading };
}

/**
 * Translation key for a dispute callable's failure. The server's messages
 * are English; these say the same thing in the user's language.
 */
export function disputeErrorKey(err: any): string {
  switch (err?.details?.reason) {
    case 'dispute_window_closed':
      return 'disputes.error.windowClosed';
    case 'already_disputed':
      return 'disputes.error.alreadyDisputed';
    case 'too_many_disputes':
      return 'disputes.error.tooMany';
    case 'kind_not_allowed':
      return 'disputes.error.kindNotAllowed';
    case 'dispute_closed':
      return 'disputes.error.closed';
    case 'not_uncredited':
      return 'disputes.error.notUncredited';
    default:
      return 'disputes.error.generic';
  }
}

import { auth, firestore, functions } from './firebase.config';
import { logger } from '../utils/logger';

export type PayoutRoute = 'bank' | 'zaad' | 'edahab' | 'cash';
export type PayoutStatus = 'requested' | 'paid' | 'rejected';

export interface PayoutRequestInput {
  amountCents: number;
  route: PayoutRoute;
  destinationName: string;
  destinationRef: string;
  note?: string;
  pin: string;
}

export interface PayoutRecord {
  id: string;
  amountCents: number;
  route: PayoutRoute;
  destinationName: string;
  destinationRef: string;
  status: PayoutStatus;
  createdAt: Date;
  decidedAt?: Date;
  decisionReason?: string;
  externalReference?: string;
}

export async function requestPayout(
  input: PayoutRequestInput,
): Promise<{ payoutId: string; amountCents: number }> {
  try {
    const fn = functions().httpsCallable('requestPayout');
    const result = await fn(input);
    const data = result.data as {
      success: boolean;
      error?: string;
      data: { payoutId: string; amountCents: number };
    };
    if (!data.success) {
      throw new Error(data.error || 'Payout request failed');
    }
    return data.data;
  } catch (error: any) {
    logger.error('Request payout error:', error);
    throw new Error(error.message || 'Payout request failed');
  }
}

/**
 * Watch this merchant's payouts.
 *
 * A live subscription rather than a fetch: the merchant is waiting on money,
 * and "requested" turning into "sent" is the whole reassurance. The rule on
 * `payoutRequests` scopes reads to the owner, so this query is the only one a
 * merchant can make.
 */
export function watchMyPayouts(
  onChange: (payouts: PayoutRecord[]) => void,
  onError?: (error: Error) => void,
  limit = 10,
): () => void {
  const uid = auth().currentUser?.uid;
  if (!uid) {
    onChange([]);
    return () => undefined;
  }

  return firestore()
    .collection('payoutRequests')
    .where('merchantId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .onSnapshot(
      (snap) => {
        onChange(
          snap.docs.map((doc) => {
            const d: any = doc.data();
            return {
              id: doc.id,
              amountCents: d.amountCents ?? 0,
              route: d.route,
              destinationName: d.destinationName ?? '',
              destinationRef: d.destinationRef ?? '',
              status: d.status,
              createdAt: d.createdAt?.toDate?.() ?? new Date(),
              decidedAt: d.decidedAt?.toDate?.(),
              decisionReason: d.decisionReason,
              externalReference: d.externalReference,
            };
          }),
        );
      },
      (err) => {
        logger.error('Payout watch failed:', err);
        onError?.(err as Error);
      },
    );
}

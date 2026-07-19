import { useEffect, useState, useRef } from 'react';
import { firestore, auth } from '../services/firebase.config';
import { logger } from '../utils/logger';

export interface PendingPaymentRequest {
  id: string;
  merchantId: string;
  merchantName: string;
  customerId: string;
  tokenId: string;
  amount: number;
  currency: string;
  status: string;
  reference?: string;
  createdAt: Date;
}

const merchantNameCache: Record<string, string> = {};

async function resolveMerchantName(merchantId: string): Promise<string> {
  if (merchantNameCache[merchantId]) return merchantNameCache[merchantId];
  try {
    const profileDoc = await firestore()
      .collection('merchantProfiles')
      .doc(merchantId)
      .get();
    if (profileDoc.exists) {
      const name = profileDoc.data()?.businessName;
      if (name) {
        merchantNameCache[merchantId] = name;
        return name;
      }
    }
    const userDoc = await firestore().collection('users').doc(merchantId).get();
    const name = userDoc.data()?.fullName || 'Merchant';
    merchantNameCache[merchantId] = name;
    return name;
  } catch {
    return 'Merchant';
  }
}

export function usePaymentRequests() {
  const [requests, setRequests] = useState<PendingPaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const uid = auth().currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return;
    }

    const unsubscribe = firestore()
      .collection('paymentRequests')
      .where('customerId', '==', uid)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        async (snapshot) => {
          const raw = snapshot.docs.map((doc) => {
            const d = doc.data();
            return {
              id: doc.id,
              merchantId: d.merchantId as string,
              customerId: d.customerId as string,
              tokenId: d.tokenId as string,
              amount: d.amount as number,
              currency: d.currency as string,
              status: d.status as string,
              reference: d.reference as string | undefined,
              createdAt: d.createdAt?.toDate() ?? new Date(),
            };
          });

          const uniqueIds = [...new Set(raw.map((r) => r.merchantId))];
          await Promise.all(uniqueIds.map(resolveMerchantName));

          if (!isMounted.current) return;

          const items: PendingPaymentRequest[] = raw.map((r) => ({
            ...r,
            merchantName: merchantNameCache[r.merchantId] || 'Merchant',
          }));

          setRequests(items);
          setLoading(false);
        },
        (err) => {
          logger.error('Payment requests listener error:', err);
          if (isMounted.current) setLoading(false);
        }
      );

    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, []);

  return { requests, loading };
}

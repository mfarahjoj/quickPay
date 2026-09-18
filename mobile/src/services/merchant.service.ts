import { functions } from './firebase.config';
import { PaymentResult } from '../types';

export interface MerchantStickerData {
  qrData: string;
  merchantName: string;
  merchantId: string;
  businessAddress: string;
}

/**
 * Fetch the authenticated merchant's permanent sticker QR payload.
 */
export async function getMerchantSticker(
  includeAmount?: boolean,
  amount?: number,
): Promise<MerchantStickerData> {
  const fn = functions().httpsCallable('generateMerchantSticker');
  const result = await fn({ includeAmount, amount });
  const data = result.data as { success: boolean; error?: string; data: MerchantStickerData };

  if (!data.success) {
    throw new Error(data.error || 'Failed to generate sticker');
  }

  return data.data;
}

/**
 * Pay a merchant directly by merchantId (used for permanent sticker QR).
 * Amount should be in dollars — the function converts to cents for the backend.
 */
export async function payMerchant(
  merchantId: string,
  amountDollars: number,
  currency: string,
  pin: string,
  /**
   * Same key on every retry of the same payment. Without it, a retry after a
   * dropped connection is a second payment — see `utils/idempotency.ts`.
   */
  idempotencyKey?: string,
): Promise<PaymentResult> {
  const fn = functions().httpsCallable('payMerchant');
  const result = await fn({
    merchantId,
    amount: Math.round(amountDollars * 100),
    currency,
    pin,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  const data = result.data as { success: boolean; error?: string; data: PaymentResult };
  if (!data.success) {
    throw new Error(data.error || 'Payment failed');
  }

  return data.data;
}

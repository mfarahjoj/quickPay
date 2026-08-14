import { functions } from './firebase.config';
import { QRCodeData, MerchantStickerData } from '../types';
import { logger } from '../utils/logger';

/**
 * Generate a single-use QR code for a merchant sale.
 *
 * `amountCents` is already in whole cents — callers must convert from the
 * text field before calling, so no float ever reaches the wire.
 */
export async function generateQRCode(
  amountCents: number,
  currency: string = 'USD',
  reference?: string
): Promise<QRCodeData> {
  try {
    const generateQRFunction = functions().httpsCallable('generateQRCode');
    const result = await generateQRFunction({
      amount: amountCents,
      currency,
      ...(reference ? { reference } : {}),
    });

    const payload = result.data as {
      success: boolean;
      error?: string;
      data: {
        qrCodeId: string;
        qrData: string;
        emvQrData?: string;
        expiresAt: string;
        feeCents: number;
        netCents: number;
        merchantName: string;
      };
    };

    if (!payload.success) {
      throw new Error(payload.error || 'Failed to generate QR code');
    }

    return {
      qrCodeId: payload.data.qrCodeId,
      // Prefer the EMV payload: it is ~3x shorter than the legacy encrypted
      // blob, which means a far less dense QR and a much better scan rate on
      // a phone screen outdoors.
      qrData: payload.data.emvQrData || payload.data.qrData,
      expiresAt: new Date(payload.data.expiresAt),
      feeCents: payload.data.feeCents ?? 0,
      netCents: payload.data.netCents ?? amountCents,
      merchantName: payload.data.merchantName ?? '',
    };
  } catch (error: any) {
    logger.error('Generate QR code error:', error);
    throw error;
  }
}

/**
 * Void an unpaid code so an abandoned sale can't be paid off a stale screen.
 * Best-effort by design: the code expires on its own within minutes, so a
 * failure here must never block the merchant from starting the next sale.
 */
export async function cancelQRCode(qrCodeId: string): Promise<void> {
  try {
    const cancelFn = functions().httpsCallable('cancelQRCode');
    await cancelFn({ qrCodeId });
  } catch (error: any) {
    logger.warn('Cancel QR code failed:', error);
  }
}

/**
 * Fetch the merchant's permanent counter code — the printable QR that sits on
 * the counter and works with the merchant's phone off or away.
 */
export async function generateMerchantSticker(): Promise<MerchantStickerData> {
  try {
    const stickerFn = functions().httpsCallable('generateMerchantSticker');
    const result = await stickerFn({});

    const payload = result.data as {
      success: boolean;
      error?: string;
      data: MerchantStickerData;
    };

    if (!payload.success) {
      throw new Error(payload.error || 'Failed to generate counter code');
    }

    return payload.data;
  } catch (error: any) {
    logger.error('Generate merchant sticker error:', error);
    throw error;
  }
}

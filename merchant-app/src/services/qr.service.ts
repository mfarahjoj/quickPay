import { functions } from './firebase.config';
import { QRCodeData } from '../types';
import { logger } from '../utils/logger';

/**
 * Generate a QR code for merchant payment
 */
export async function generateQRCode(
  amount: number,
  currency: string = 'USD',
  reference?: string
): Promise<QRCodeData> {
  try {
    const generateQRFunction = functions().httpsCallable('generateQRCode');
    const result = await generateQRFunction({
      amount: Math.round(amount * 100),
      currency,
      ...(reference ? { reference } : {}),
    });

    const payload = result.data as {
      success: boolean;
      error?: string;
      data: {
        qrCodeId: string;
        qrData: string;
        expiresAt: string;
      };
    };

    if (!payload.success) {
      throw new Error(payload.error || 'Failed to generate QR code');
    }

    return {
      qrCodeId: payload.data.qrCodeId,
      qrData: payload.data.qrData,
      expiresAt: new Date(payload.data.expiresAt),
    };
  } catch (error: any) {
    logger.error('Generate QR code error:', error);
    throw new Error(error.message || 'Failed to generate QR code');
  }
}

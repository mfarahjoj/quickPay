import { functions } from './firebase.config';
import { QRCodeData, PaymentResult } from '../types';
import { logger } from '../utils/logger';

/**
 * Generate a QR code for merchant payment
 */
export async function generateQRCode(
  amount: number,
  currency: string = 'USD'
): Promise<QRCodeData> {
  try {
    const generateQRFunction = functions().httpsCallable('generateQRCode');
    const result = await generateQRFunction({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
    });

    const data = result.data as {
      success: boolean;
      error?: string;
      data: { qrCodeId: string; qrData: string; expiresAt: string }
    };
    if (!data.success) {
      throw new Error(data.error || 'Failed to generate QR code');
    }

    return {
      qrCodeId: data.data.qrCodeId,
      qrData: data.data.qrData,
      expiresAt: new Date(data.data.expiresAt),
    };
  } catch (error: any) {
    logger.error('Generate QR code error:', error);
    throw new Error(error.message || 'Failed to generate QR code');
  }
}

/**
 * Validate a scanned QR code
 */
export async function validateQRCode(qrData: string): Promise<{
  valid: boolean;
  qrCodeId?: string;
  merchantId?: string;
  merchantName?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  reason?: string;
  isMerchantSticker?: boolean;
}> {
  try {
    const validateQRFunction = functions().httpsCallable('validateQRCode');
    const result = await validateQRFunction({ qrData });

    const data = result.data as {
      data: {
        valid: boolean;
        qrCodeId?: string;
        merchantId?: string;
        merchantName?: string;
        amount?: number;
        currency?: string;
        reference?: string;
        reason?: string;
        isMerchantSticker?: boolean;
      }
    };
    return data.data;
  } catch (error: any) {
    logger.error('Validate QR code error:', error);
    throw new Error(error.message || 'Failed to validate QR code');
  }
}

/**
 * Process a payment from scanned QR code
 */
export async function processPayment(
  qrCodeId: string,
  pin: string
): Promise<PaymentResult> {
  try {
    const processPaymentFunction = functions().httpsCallable('processPayment');
    const result = await processPaymentFunction({
      qrCodeId,
      customerId: '', // Will be set by backend from auth context
      pin,
    });

    const data = result.data as { success: boolean; error?: string; data: PaymentResult };
    if (!data.success) {
      throw new Error(data.error || 'Payment failed');
    }

    return data.data;
  } catch (error: any) {
    logger.error('Process payment error:', error);
    // Keep the callable's code and details: the screen explains some refusals
    // (such as the pause after a PIN reset) from them.
    if (error?.code) throw error;
    throw new Error(error.message || 'Payment failed');
  }
}

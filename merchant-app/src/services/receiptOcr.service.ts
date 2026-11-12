import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from './firebase.config';
import { OcrLine, ParsedReceipt, parseReceipt } from '../utils/receiptParser';
import { logger } from '../utils/logger';

/**
 * Receipt reading. The photo is read on the phone (Apple Vision, through the
 * local ZappReceiptOCR pod) and never uploaded: a till receipt carries the
 * merchant's phone and wallet numbers and there is no reason for it to leave
 * the device.
 */

const Native: { recognize(path: string): Promise<OcrLine[]> } | undefined =
  NativeModules.ZappReceiptOCR;

/** False on a build made before the pod was installed. */
export function isReceiptOcrAvailable(): boolean {
  return !!Native?.recognize;
}

// ── The merchant's own identifier ─────────────────────────────────────────
// Every till prints something different: an invoice number at one shop, a
// KOT or bill number at the next. Once a merchant picks which one is theirs
// it is remembered, so the next receipt needs no choosing.

const prefKey = () => `receipt.identifierKind.${auth().currentUser?.uid ?? 'anon'}`;

export async function getPreferredIdentifierKind(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(prefKey());
  } catch {
    return null;
  }
}

export async function setPreferredIdentifierKind(kind: string | null): Promise<void> {
  try {
    if (kind) await AsyncStorage.setItem(prefKey(), kind);
    else await AsyncStorage.removeItem(prefKey());
  } catch (e) {
    // Only costs the merchant one extra tap next time.
    logger.warn('Saving receipt identifier preference failed:', e);
  }
}

/** Read a photographed receipt at `path` into an amount and sale identifiers. */
export async function readReceipt(path: string): Promise<ParsedReceipt> {
  if (!Native?.recognize) throw new Error('receipt-ocr-unavailable');
  const [lines, preferred] = await Promise.all([
    Native.recognize(path),
    getPreferredIdentifierKind(),
  ]);
  return parseReceipt(Array.isArray(lines) ? lines : [], preferred);
}

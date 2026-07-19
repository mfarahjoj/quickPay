import auth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { functions } from './firebase.config';

export interface TokenResponse {
  tokenId: string;
  tokenData: string;
  expiresAt: string;
}

/** Must match backend TOKEN_TTL_MS in functions/src/customer-qr/generateToken.ts */
export const CUSTOMER_TOKEN_TTL_MS = 2 * 60 * 1000;
export const CUSTOMER_TOKEN_TTL_SECONDS = 120;
/** How many seconds to wait before retrying after a silent auto-refresh failure. */
export const BACKOFF_SECONDS_ON_FAILURE = 90;

const RECEIVE_TOKEN_CACHE_KEY = '@quickpay/receive_customer_token_v1';

/** Cached payload includes uid so we never show another user's QR after account switch. */
interface ReceiveTokenCacheEnvelope {
  uid: string;
  token: TokenResponse;
}

/** Stop reusing cache this long before server expiry so scans still succeed. */
const CACHE_EXPIRY_BUFFER_MS = 15_000;

function isTokenWithinBuffer(token: TokenResponse): boolean {
  if (token.tokenId === 'offline') return false;
  const exp = new Date(token.expiresAt).getTime();
  if (Number.isNaN(exp)) return false;
  return Date.now() < exp - CACHE_EXPIRY_BUFFER_MS;
}

/**
 * Valid server token from disk if still usable (same user, not near expiry).
 */
export async function readCachedReceiveToken(): Promise<TokenResponse | null> {
  try {
    const raw = await AsyncStorage.getItem(RECEIVE_TOKEN_CACHE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as ReceiveTokenCacheEnvelope;
    const uid = auth().currentUser?.uid;
    if (!uid || envelope.uid !== uid || !envelope.token?.tokenData || !envelope.token?.expiresAt) {
      await AsyncStorage.removeItem(RECEIVE_TOKEN_CACHE_KEY);
      return null;
    }
    if (!isTokenWithinBuffer(envelope.token)) {
      await AsyncStorage.removeItem(RECEIVE_TOKEN_CACHE_KEY);
      return null;
    }
    return envelope.token;
  } catch {
    return null;
  }
}

async function writeCachedReceiveToken(token: TokenResponse): Promise<void> {
  if (token.tokenId === 'offline') return;
  const uid = auth().currentUser?.uid;
  if (!uid) return;
  try {
    const envelope: ReceiveTokenCacheEnvelope = { uid, token };
    await AsyncStorage.setItem(RECEIVE_TOKEN_CACHE_KEY, JSON.stringify(envelope));
  } catch {
    /* ignore */
  }
}

/** Clears receive QR cache (e.g. sign-out or forced new code). */
export async function clearReceiveTokenCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECEIVE_TOKEN_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export interface ScanTokenResult {
  valid: boolean;
  tokenId: string;
  customerName: string;
  customerId: string;
}

export async function generateToken(): Promise<TokenResponse> {
  const fn = functions().httpsCallable('generateCustomerToken');
  const result = await fn({});
  const data = result.data as { success: boolean; error?: string; data: TokenResponse };

  if (!data.success) {
    throw new Error(data.error || 'Failed to generate token');
  }

  return data.data;
}

/**
 * Reuses a cached receive token until near expiry, or calls `generateToken` and updates cache.
 * Pass `forceRefresh: true` to always hit the network (e.g. user tapped "new code").
 */
export async function resolveReceiveToken(options?: { forceRefresh?: boolean }): Promise<TokenResponse> {
  const force = options?.forceRefresh === true;
  if (!force) {
    const cached = await readCachedReceiveToken();
    if (cached) return cached;
  } else {
    await clearReceiveTokenCache();
  }
  const fresh = await generateToken();
  await writeCachedReceiveToken(fresh);
  return fresh;
}

/** Compute how many seconds remain before a token expires, clamped to [0, clamp]. */
export function secondsLeftFromToken(
  token: TokenResponse,
  opts?: { clamp?: number },
): number {
  const exp = new Date(token.expiresAt).getTime();
  const raw = Math.floor((exp - Date.now()) / 1000);
  const max = opts?.clamp ?? CUSTOMER_TOKEN_TTL_SECONDS;
  return Math.min(max, Math.max(0, raw));
}

/** Constructs an offline TokenResponse with a local QR payload, or null if no user is signed in. */
export function buildOfflineReceiveToken(): TokenResponse | null {
  const payload = buildLocalCustomerQrPayload();
  if (!payload) return null;
  return {
    tokenId: 'offline',
    tokenData: payload,
    expiresAt: new Date(Date.now() + CUSTOMER_TOKEN_TTL_MS).toISOString(),
  };
}

/** Same payload as home-screen fallback when Cloud Function is unavailable or rejects (e.g. non-customer). */
export function buildLocalCustomerQrPayload(): string | null {
  const uid = auth().currentUser?.uid;
  if (!uid) return null;
  return JSON.stringify({ type: 'quickpay_customer', uid, ts: Date.now() });
}

/**
 * True when generateCustomerToken will keep failing until account type changes (e.g. merchant).
 * Used to avoid hammering Cloud Functions on auto-refresh.
 */
export function isReceiveTokenPermissionError(e: unknown): boolean {
  const code = String((e as { code?: string })?.code ?? '');
  const msg = String((e as { message?: string })?.message ?? '');
  if (code === 'functions/permission-denied') return true;
  if (/only customers can generate/i.test(msg)) return true;
  return false;
}

/**
 * Merchant scans customer token QR — validates and marks token as scanned.
 */
export async function scanCustomerToken(tokenData: string): Promise<ScanTokenResult> {
  const fn = functions().httpsCallable('scanCustomerToken');
  const result = await fn({ tokenData });
  const data = result.data as { success: boolean; error?: string; data: ScanTokenResult };

  if (!data.success) {
    throw new Error(data.error || 'Invalid customer QR');
  }

  return data.data;
}

/**
 * Merchant creates a payment request after scanning customer token.
 * Amount should be in dollars — converted to cents before sending.
 */
export async function createPaymentRequest(
  tokenId: string,
  amountDollars: number,
  currency: string,
): Promise<{ requestId: string }> {
  const fn = functions().httpsCallable('createPaymentRequest');
  const result = await fn({
    tokenId,
    amount: Math.round(amountDollars * 100),
    currency,
  });
  const data = result.data as { success: boolean; error?: string; data: { requestId: string } };

  if (!data.success) {
    throw new Error(data.error || 'Failed to create payment request');
  }

  return data.data;
}

export async function approvePayment(
  requestId: string,
  pin: string
): Promise<{ transactionId: string; amount: number }> {
  const fn = functions().httpsCallable('approvePaymentRequest');
  const result = await fn({ requestId, pin });
  const data = result.data as {
    success: boolean;
    error?: string;
    data: { transactionId: string; amount: number };
  };

  if (!data.success) {
    throw new Error(data.error || 'Failed to approve payment');
  }

  return data.data;
}

export async function rejectPayment(requestId: string): Promise<void> {
  const fn = functions().httpsCallable('rejectPaymentRequest');
  const result = await fn({ requestId });
  const data = result.data as { success: boolean; error?: string };

  if (!data.success) {
    throw new Error(data.error || 'Failed to reject payment');
  }
}

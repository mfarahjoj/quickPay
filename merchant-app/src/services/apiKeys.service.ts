import firebase from '@react-native-firebase/app';
import { functions } from './firebase.config';
import { logger } from '../utils/logger';

/**
 * The merchant's own Merchant API keys (functions/src/merchants/apiKeys.ts).
 *
 * Test keys (`zpk_test_`) never move money and need no PIN; live keys take
 * real payments and refunds, so making one needs the PIN. The key itself comes
 * back exactly once, from create — the server keeps only its hash.
 *
 * Errors are rethrown as they came, so callers can still read `code` (a wrong
 * PIN is `functions/permission-denied`).
 */

export type ApiKeyMode = 'live' | 'test';

export interface ApiKeyRow {
  keyId: string;
  label: string;
  /** `zpk_test_abcd…wxyz` */
  hint: string;
  mode: ApiKeyMode;
  revoked: boolean;
  createdAt: string;
  createdVia: 'console' | 'merchant_app';
  lastUsedAt?: string;
  revokedAt?: string;
}

/** Mirrors MAX_ACTIVE_KEYS_PER_MODE in functions/src/api/keys.ts. */
export const MAX_ACTIVE_KEYS_PER_MODE = 5;

/** Where integrators send requests; the Hosting rewrite in firebase.json serves /v1. */
export function apiBaseUrl(): string {
  const projectId = firebase.app().options.projectId;
  if (projectId === 'quickpay-485417') return 'https://zapppay.web.app/v1';
  return `https://${projectId}.web.app/v1`;
}

function unwrap<T>(result: { data: unknown }, fallback: string): T {
  const data = result.data as { success: boolean; error?: string; data: T };
  if (!data.success) throw new Error(data.error || fallback);
  return data.data;
}

export async function listMyApiKeys(): Promise<ApiKeyRow[]> {
  try {
    const result = await functions().httpsCallable('listMyApiKeys')();
    return unwrap<{ keys: ApiKeyRow[] }>(result, 'Could not load API keys').keys;
  } catch (error) {
    logger.error('List API keys error:', error);
    throw error;
  }
}

export async function createMyApiKey(input: {
  label: string;
  mode: ApiKeyMode;
  pin?: string;
}): Promise<ApiKeyRow & { apiKey: string }> {
  try {
    const result = await functions().httpsCallable('createMyApiKey')(input);
    return unwrap<ApiKeyRow & { apiKey: string }>(result, 'Could not create API key');
  } catch (error) {
    logger.error('Create API key error:', error);
    throw error;
  }
}

export async function revokeMyApiKey(keyId: string): Promise<ApiKeyRow> {
  try {
    const result = await functions().httpsCallable('revokeMyApiKey')({ keyId });
    return unwrap<ApiKeyRow>(result, 'Could not revoke API key');
  } catch (error) {
    logger.error('Revoke API key error:', error);
    throw error;
  }
}

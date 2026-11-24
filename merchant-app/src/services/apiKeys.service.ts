import firebase from '@react-native-firebase/app';
import { functions } from './firebase.config';
import { logger } from '../utils/logger';

/**
 * The merchant's own Merchant API keys (functions/src/merchants/apiKeys.ts).
 *
 * Test keys (`zpk_test_`) never move money and need no PIN; live keys take
 * real payments and refunds, so the shop asks Zapp for live access once
 * (requestLiveApiAccess) and, once approved, makes each one with the PIN. The
 * key itself comes back exactly once, from create — the server keeps only its
 * hash.
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

/** Mirrors PURPOSE_MIN / PURPOSE_MAX in functions/src/api/liveAccess.ts. */
export const LIVE_PURPOSE_MIN = 10;
export const LIVE_PURPOSE_MAX = 300;

export type LiveAccessStatus = 'none' | 'pending' | 'approved' | 'declined' | 'withdrawn';

/** Whether Zapp lets this shop make live keys (functions/src/api/liveAccess.ts). */
export interface LiveAccess {
  status: LiveAccessStatus;
  /** What the shop said the keys are for. */
  purpose: string | null;
  /** Zapp's message with a decline or a withdrawal. */
  note: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  /** Approved because it held a live key before approvals existed. */
  legacy: boolean;
}

/** A server from before approvals sends no liveAccess: live keys worked as they always had. */
const ACCESS_BEFORE_APPROVALS: LiveAccess = {
  status: 'approved',
  purpose: null,
  note: null,
  requestedAt: null,
  decidedAt: null,
  legacy: true,
};

/** The server refused a live key because the shop has no live access (yet, or any more). */
export function isLiveAccessRequired(error: any): boolean {
  return error?.code === 'functions/failed-precondition' && error?.details?.reason === 'live_access_required';
}

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

export async function listMyApiKeys(): Promise<{ keys: ApiKeyRow[]; liveAccess: LiveAccess }> {
  try {
    const result = await functions().httpsCallable('listMyApiKeys')();
    const data = unwrap<{ keys: ApiKeyRow[]; liveAccess?: LiveAccess }>(result, 'Could not load API keys');
    return { keys: data.keys, liveAccess: data.liveAccess ?? ACCESS_BEFORE_APPROVALS };
  } catch (error) {
    logger.error('List API keys error:', error);
    throw error;
  }
}

/** Ask Zapp for live access, saying what the keys are for. */
export async function requestLiveApiAccess(purpose: string): Promise<LiveAccess> {
  try {
    const result = await functions().httpsCallable('requestLiveApiAccess')({ purpose });
    return unwrap<LiveAccess>(result, 'Could not send the request');
  } catch (error) {
    logger.error('Request live API access error:', error);
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

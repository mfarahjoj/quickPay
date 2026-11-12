/**
 * True when Firestore holds a bcrypt PIN hash (set by setupPin), not a placeholder.
 * Empty string from onCreate and other junk values must be false so onboarding collects a PIN.
 */
export function hasStoredPinHash(pinHash: unknown): boolean {
  if (typeof pinHash !== 'string') {
    return false;
  }
  return pinHash.startsWith('$2') && pinHash.length >= 20;
}

/**
 * Whether the account has a PIN. New accounts carry `hasPin`; the hash itself
 * moved server-only (ONBOARDING_SECURITY_REVIEW.md A1), so `pinHash` is only
 * seen on accounts the migration hasn't reached yet.
 */
export function userHasPin(data: { hasPin?: unknown; pinHash?: unknown } | undefined): boolean {
  return data?.hasPin === true || hasStoredPinHash(data?.pinHash);
}

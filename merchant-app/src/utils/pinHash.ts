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

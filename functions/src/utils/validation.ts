import { https } from "firebase-functions/v2";

/**
 * Validate phone number format (Somalia: +252)
 */
export function validatePhoneNumber(phoneNumber: string): boolean {
  const phoneRegex = /^\+252[0-9]{9}$/;
  return phoneRegex.test(phoneNumber);
}

/**
 * True when Firestore holds a bcrypt PIN hash from setupPin (not "" or placeholders).
 */
export function hasStoredPinHash(pinHash: unknown): boolean {
  if (typeof pinHash !== "string") {
    return false;
  }
  return pinHash.startsWith("$2") && pinHash.length >= 20;
}

/**
 * Validate what a caller may send as `pin` to approve something: six digits,
 * or a one-time Face ID token from approveBiometric ("bio_" + 32 hex,
 * auth/biometricKeys.ts). A new PIN additionally passes assertStrongPin,
 * which takes six digits only, so a token can never be set as a PIN.
 */
export function validatePin(pin: string): boolean {
  return /^[0-9]{6}$/.test(pin) || /^bio_[0-9a-f]{32}$/.test(pin);
}

/**
 * Validate amount (must be positive and in cents)
 */
export function validateAmount(amount: number): boolean {
  return amount > 0 && Number.isInteger(amount);
}

/**
 * Currencies a payment may be made in. USD only: every wallet is USD, and
 * an SLS amount debited from one would be read as dollars (the ledger
 * refuses that too — CurrencyMismatchError). Add SLS here once wallets can
 * hold it and the apps show it.
 */
export const SUPPORTED_CURRENCIES: readonly string[] = ["USD"];

export function validateCurrency(currency: string): boolean {
  return SUPPORTED_CURRENCIES.includes(currency);
}

/**
 * Validate user ID format
 */
export function validateUserId(userId: string): boolean {
  return userId.length > 0 && userId.length < 129;
}

/**
 * Sanitize user input
 */
export function sanitizeString(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if authenticated user matches required userId
 */
export function isAuthenticatedUser(
  context: https.CallableRequest,
  userId: string
): boolean {
  return context.auth?.uid === userId;
}

/**
 * Validate request has authentication
 */
export function requireAuth(context: https.CallableRequest): void {
  if (!context.auth) {
    throw new https.HttpsError(
      "unauthenticated",
      "User must be authenticated to perform this action"
    );
  }
}

/**
 * Format amount from dollars to cents
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Format amount from cents to dollars
 */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

// validateTransactionLimit lived here with its own hardcoded thresholds, which
// disagreed with the table getAccountLimits showed customers. Limits now come
// from config/limits via utils/limits.ts — one table, advertised and enforced.

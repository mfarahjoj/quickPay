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
 * Validate PIN format (6 digits)
 */
export function validatePin(pin: string): boolean {
  const pinRegex = /^[0-9]{6}$/;
  return pinRegex.test(pin);
}

/**
 * Validate amount (must be positive and in cents)
 */
export function validateAmount(amount: number): boolean {
  return amount > 0 && Number.isInteger(amount);
}

/**
 * Validate currency code
 */
export function validateCurrency(currency: string): boolean {
  const validCurrencies = ["USD", "SLS"];
  return validCurrencies.includes(currency);
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

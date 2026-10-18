import { defineSecret } from "firebase-functions/params";

/**
 * AES-256 key (64-char hex = 32 bytes) used by utils/encryption.
 *
 * Bound only to the functions that actually encrypt or decrypt — currently the
 * customer-presented token pair (generateCustomerToken / scanCustomerToken).
 * Merchant payment QRs deliberately do not need it: their payload is an EMV
 * string carrying only public identifiers, validated server-side.
 *
 * Set it once per project before deploying those functions:
 *   firebase functions:secrets:set ENCRYPTION_KEY
 */
export const ENCRYPTION_KEY = defineSecret("ENCRYPTION_KEY");

/**
 * PIN pepper (ONBOARDING_SECURITY_REVIEW.md A2): a key only the verifier
 * holds. PINs are stored as bcrypt(HMAC-SHA256(pepper, pin)), so a copy of the
 * database alone isn't enough to try PINs offline (NIST SP 800-63B 5.1.1.2).
 *
 * Bound to every function (globalOptions.ts), since any of them may check a
 * PIN. Set it once per project before deploying, and never change it: every
 * peppered PIN depends on it.
 *   openssl rand -hex 32 | firebase functions:secrets:set PIN_PEPPER --data-file=-
 */
export const PIN_PEPPER = defineSecret("PIN_PEPPER");

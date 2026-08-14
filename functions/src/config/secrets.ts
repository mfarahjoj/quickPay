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

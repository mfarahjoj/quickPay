/**
 * What a customer's phone signs to approve one agreement charge, and the check.
 *
 * The partner's app keeps an EC P-256 key on the phone's secure chip (iPhone
 * Secure Enclave, Android Keystore) that only the customer's face, fingerprint
 * or phone passcode can use. It signs this text with ECDSA-SHA256; the
 * signature is DER, base64. The text names the charge, so a signature can
 * never pay another one, and the amount, so the partner can't show one amount
 * and take another. Only this file builds it.
 */

import * as crypto from "crypto";
import { publicKeyFrom, signatureValid } from "../auth/biometricKeys";

export { signatureValid };

export function chargeConfirmationPayload(c: {
  chargeId: string;
  agreementId: string;
  amount: number;
  currency: "USD" | "SLS";
}): string {
  return `zapp-agreement-charge:v1:${c.chargeId}:${c.agreementId}:${c.amount}:${c.currency}`;
}

/** Whether [base64] is an EC P-256 public key in SPKI DER, the only kind an agreement accepts. */
export function isP256PublicKey(base64: string): boolean {
  try {
    const key: crypto.KeyObject = publicKeyFrom(base64);
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

/**
 * Biometrics backed by a hardware key (ONBOARDING_SECURITY_REVIEW.md A4, D11).
 *
 * Before, Face ID worked by keeping the PIN in the Keychain behind an in-app
 * prompt the hardware didn't enforce. Now the phone makes a key pair that
 * only Face ID or a fingerprint can use (react-native-biometrics createKeys)
 * and sends us the public half. To approve something:
 *
 *   1. biometricChallenge: we hand out a fresh random payload.
 *   2. The phone signs it, which needs the biometric check.
 *   3. approveBiometric: we check the signature against the stored key and
 *      return a one-time token, "bio_<challengeId>", good for two minutes.
 *   4. The phone passes that token as `pin` to whatever it's approving.
 *      verifyUserPin accepts it once (see consumeBiometricToken).
 *
 * The PIN is never stored on the phone. A token can't become a new PIN: the
 * weak-PIN check refuses anything but six digits.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import * as crypto from "crypto";
import { requireAuth } from "../utils/validation";
import { verifyUserPin } from "./validatePin";
import { ApiResponse } from "../types";

const KEYS = "biometricKeys";
const CHALLENGES = "biometricChallenges";
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const TOKEN_PREFIX = "bio_";

export function isBiometricToken(value: unknown): value is string {
  return typeof value === "string" && /^bio_[0-9a-f]{32}$/.test(value);
}

/** The text the phone signs for this challenge. */
export function challengePayload(uid: string, challengeId: string, nonce: string): string {
  return `zapp-biometric:${uid}:${challengeId}:${nonce}`;
}

/** Android sends SubjectPublicKeyInfo; accept a bare PKCS#1 key too. */
export function publicKeyFrom(base64: string): crypto.KeyObject {
  const der = Buffer.from(base64, "base64");
  try {
    return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    return crypto.createPublicKey({ key: der, format: "der", type: "pkcs1" });
  }
}

/** SHA256withRSA, as react-native-biometrics signs on both platforms. */
export function signatureValid(publicKey: string, payload: string, signature: string): boolean {
  try {
    return crypto.verify("sha256", Buffer.from(payload, "utf8"), publicKeyFrom(publicKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Turn on biometric approval for this phone. Needs the real PIN. */
export const registerBiometricKey = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ publicKey: string; pin: string; platform?: string }>): Promise<ApiResponse<{ keyId: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const { publicKey, pin } = request.data ?? {};
    if (typeof publicKey !== "string" || publicKey.length < 100 || publicKey.length > 2048) {
      throw new https.HttpsError("invalid-argument", "publicKey is required");
    }
    try {
      publicKeyFrom(publicKey);
    } catch {
      throw new https.HttpsError("invalid-argument", "That isn't a public key");
    }
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
      throw new https.HttpsError("invalid-argument", "PIN must be exactly 6 digits");
    }
    if (!(await verifyUserPin(uid, pin))) {
      throw new https.HttpsError("permission-denied", "Invalid PIN");
    }
    const keyId = crypto.randomBytes(16).toString("hex");
    await admin.firestore().collection(KEYS).doc(keyId).set({
      uid,
      publicKey,
      platform: typeof request.data?.platform === "string" ? request.data.platform.slice(0, 16) : "unknown",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUsedAt: null,
    });
    return { success: true, data: { keyId } };
  }
);

/** Turn it off for one phone. */
export const removeBiometricKey = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ keyId: string }>): Promise<ApiResponse> => {
    requireAuth(request);
    const keyId = request.data?.keyId;
    if (typeof keyId !== "string" || !keyId) throw new https.HttpsError("invalid-argument", "keyId is required");
    const ref = admin.firestore().collection(KEYS).doc(keyId);
    const snap = await ref.get();
    if (snap.exists && snap.data()?.uid === request.auth!.uid) await ref.delete();
    return { success: true };
  }
);

export const biometricChallenge = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<unknown>): Promise<ApiResponse<{ challengeId: string; payload: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const challengeId = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");
    await admin.firestore().collection(CHALLENGES).doc(challengeId).set({
      uid,
      nonce,
      status: "pending",
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + CHALLENGE_TTL_MS),
    });
    return { success: true, data: { challengeId, payload: challengePayload(uid, challengeId, nonce) } };
  }
);

export const approveBiometric = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ challengeId: string; keyId: string; signature: string }>
  ): Promise<ApiResponse<{ pinToken: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const { challengeId, keyId, signature } = request.data ?? {};
    if (typeof challengeId !== "string" || typeof keyId !== "string" || typeof signature !== "string") {
      throw new https.HttpsError("invalid-argument", "challengeId, keyId and signature are required");
    }
    const db = admin.firestore();
    const refused = () => new https.HttpsError("permission-denied", "Biometric check failed. Use your PIN.");
    const keySnap = await db.collection(KEYS).doc(keyId).get();
    // A key removed (or from another account) means: back to the PIN.
    if (!keySnap.exists || keySnap.data()?.uid !== uid) {
      throw new https.HttpsError("not-found", "Biometrics aren't set up on this phone any more.", { reason: "biometric_key_gone" });
    }
    await db.runTransaction(async (tx) => {
      const ref = db.collection(CHALLENGES).doc(challengeId);
      const ch = await tx.get(ref);
      const data = ch.data();
      if (!ch.exists || data?.uid !== uid || data?.status !== "pending" || data.expiresAt.toMillis() < Date.now()) {
        throw refused();
      }
      if (!signatureValid(keySnap.data()!.publicKey, challengePayload(uid, challengeId, data.nonce), signature)) {
        tx.update(ref, { status: "failed" });
        return;
      }
      tx.update(ref, { status: "approved", keyId, approvedAt: admin.firestore.Timestamp.now() });
    });
    const after = (await db.collection(CHALLENGES).doc(challengeId).get()).data();
    if (after?.status !== "approved") throw refused();
    await keySnap.ref.update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { success: true, data: { pinToken: TOKEN_PREFIX + challengeId } };
  }
);

/**
 * Use up a token from approveBiometric. True once, within two minutes of
 * approval, for the account it was issued to.
 */
export async function consumeBiometricToken(uid: string, token: string): Promise<boolean> {
  if (!isBiometricToken(token)) return false;
  const db = admin.firestore();
  const ref = db.collection(CHALLENGES).doc(token.slice(TOKEN_PREFIX.length));
  return db.runTransaction(async (tx) => {
    const ch = await tx.get(ref);
    const data = ch.data();
    if (!ch.exists || data?.uid !== uid || data?.status !== "approved") return false;
    if (Date.now() - data.approvedAt.toMillis() > CHALLENGE_TTL_MS) return false;
    tx.update(ref, { status: "used", usedAt: admin.firestore.Timestamp.now() });
    return true;
  });
}

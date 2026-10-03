import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import { requireAuth, validatePin } from "../utils/validation";
import { verifyUserPin } from "./validatePin";
import { ApiResponse } from "../types";

/**
 * Trusted-device PIN login.
 *
 * Signing in on a device the account has never used still requires an SMS code
 * — possession of the SIM is the only thing that can vouch for a stranger's
 * device. But once a device has completed that flow, it gets a 256-bit secret
 * that lives in the iOS Keychain and survives sign-out. Logging back in on
 * THAT device then needs the secret (possession) plus the PIN (knowledge),
 * which is two factors and never touches SMS.
 *
 * The credential binds to a uid, so the phone number drops out of login
 * entirely — there is nothing here to enumerate.
 */

const DEVICES = "trustedDevices";
const SECRET_BYTES = 32;
const SALT_ROUNDS = 12;

// The secret is 256 bits, so this isn't really guess protection — it's a cheap
// guard so a stolen device id can't be used to burn CPU on bcrypt compares.
const MAX_SECRET_ATTEMPTS = 10;
const SECRET_LOCK_SECONDS = 15 * 60;

interface RegisterRequest {
  platform?: string;
}

interface LoginRequest {
  deviceId: string;
  deviceSecret: string;
  pin: string;
}

/**
 * Mint a device credential for the signed-in user. Called once, after the
 * account has authenticated by SMS and its PIN is confirmed.
 */
export const registerTrustedDevice = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<RegisterRequest>):
    Promise<ApiResponse<{ deviceId: string; deviceSecret: string }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;

    const platform =
      typeof request.data?.platform === "string" ?
        request.data.platform.slice(0, 32) :
        "unknown";

    const db = admin.firestore();

    // The account must already have a PIN. Trusting a device before one exists
    // would mint a credential whose second factor doesn't exist yet.
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists || !userDoc.data()?.pinHash) {
      throw new https.HttpsError(
        "failed-precondition",
        "Set up your PIN before trusting this device."
      );
    }

    const deviceId = crypto.randomUUID();
    const deviceSecret = crypto.randomBytes(SECRET_BYTES).toString("hex");
    const secretHash = await bcrypt.hash(deviceSecret, SALT_ROUNDS);

    await db.collection(DEVICES).doc(deviceId).set({
      uid,
      secretHash,
      platform,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      secretFailedAttempts: 0,
      secretLockedUntil: null,
    });

    // Returned exactly once. The server keeps only the hash — if the client
    // loses this, the device has to re-verify by SMS.
    return { success: true, data: { deviceId, deviceSecret } };
  }
);

/**
 * Exchange a device secret + PIN for a Firebase custom token. Unauthenticated
 * by necessity — the caller has no session yet, which is the whole point.
 */
export const loginWithPin = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<LoginRequest>):
    Promise<ApiResponse<{ token: string }>> => {
    const { deviceId, deviceSecret, pin } = request.data ?? {};

    if (
      typeof deviceId !== "string" || !deviceId ||
      typeof deviceSecret !== "string" || !deviceSecret
    ) {
      throw new https.HttpsError(
        "invalid-argument",
        "Missing device credentials."
      );
    }
    if (!validatePin(pin)) {
      throw new https.HttpsError(
        "invalid-argument",
        "PIN must be exactly 6 digits"
      );
    }

    const db = admin.firestore();
    const deviceRef = db.collection(DEVICES).doc(deviceId);
    const deviceDoc = await deviceRef.get();

    // One generic error for "no such device", "wrong secret" and "throttled",
    // so this can't be used to probe which device ids exist.
    const denied = () => new https.HttpsError(
      "permission-denied",
      "This device isn't recognised. Sign in with a code instead."
    );

    if (!deviceDoc.exists) throw denied();
    const device = deviceDoc.data()!;

    const now = admin.firestore.Timestamp.now();
    const lockedUntil = device.secretLockedUntil as
      | admin.firestore.Timestamp
      | null
      | undefined;
    if (lockedUntil && lockedUntil.toMillis() > now.toMillis()) {
      throw denied();
    }

    const secretOk = await bcrypt.compare(deviceSecret, device.secretHash);
    if (!secretOk) {
      const attempts = (device.secretFailedAttempts ?? 0) + 1;
      const updates: Record<string, unknown> = {
        secretFailedAttempts: admin.firestore.FieldValue.increment(1),
      };
      if (attempts >= MAX_SECRET_ATTEMPTS) {
        updates.secretLockedUntil = admin.firestore.Timestamp.fromMillis(
          now.toMillis() + SECRET_LOCK_SECONDS * 1000
        );
      }
      await deviceRef.update(updates);
      throw denied();
    }

    const uid = device.uid as string;

    // createCustomToken succeeds for any uid string, and signInWithCustomToken
    // would then CREATE a fresh user record — so a stale device doc pointing at
    // a deleted account could resurrect it as an empty user. Confirm the auth
    // record still exists, and drop the device if it doesn't.
    try {
      await admin.auth().getUser(uid);
    } catch {
      await deviceRef.delete().catch(() => undefined);
      throw denied();
    }

    // Reuses the PIN lockout every other surface shares (5 failures → 60s,
    // doubling, capped at 15 min). Its resource-exhausted / not-found /
    // failed-precondition errors all propagate: the caller has already proven
    // they hold this device's secret, so none of them leak anything.
    const valid = await verifyUserPin(uid, pin);
    if (!valid) {
      throw new https.HttpsError("unauthenticated", "Incorrect PIN.");
    }

    const token = await admin.auth().createCustomToken(uid);

    await deviceRef.update({
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      secretFailedAttempts: 0,
      secretLockedUntil: null,
    });

    return { success: true, data: { token } };
  }
);

/**
 * Forget every trusted device for the signed-in user — the counterweight to
 * the above, for a lost or stolen phone. Afterwards every device must
 * re-verify by SMS.
 */
export const revokeTrustedDevices = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<unknown>):
    Promise<ApiResponse<{ revoked: number }>> => {
    requireAuth(request);
    const uid = request.auth!.uid;

    const db = admin.firestore();
    const snap = await db.collection(DEVICES).where("uid", "==", uid).get();

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    return { success: true, data: { revoked: snap.size } };
  }
);

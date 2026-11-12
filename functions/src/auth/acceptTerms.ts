import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { LEGAL_VERSIONS } from "../config/legal";
import { ApiResponse } from "../types";

/**
 * Record that the signed-in person accepted the current terms and privacy
 * policy (review B4, E12): which versions, when, and from which app.
 *
 * users/{uid}.consent holds the latest acceptance, for the apps to compare
 * against the current versions; users/{uid}/consents keeps every one, append
 * only. Clients can't write either (firestore.rules).
 */
export const acceptTerms = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ termsVersion: string; privacyVersion: string; app?: string; appVersion?: string }>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const { termsVersion, privacyVersion } = request.data ?? {};
    // Only the versions actually published: an old build showing old text
    // must not record consent to the new one.
    if (termsVersion !== LEGAL_VERSIONS.terms || privacyVersion !== LEGAL_VERSIONS.privacy) {
      throw new https.HttpsError("failed-precondition", "These terms have been updated. Update the app to see them.", {
        reason: "legal_version_mismatch",
        current: LEGAL_VERSIONS,
      });
    }
    const record = {
      termsVersion,
      privacyVersion,
      acceptedAt: admin.firestore.Timestamp.now(),
      app: typeof request.data?.app === "string" ? request.data.app.slice(0, 24) : "unknown",
      appVersion: typeof request.data?.appVersion === "string" ? request.data.appVersion.slice(0, 24) : null,
    };
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const batch = db.batch();
    batch.set(userRef, { consent: record }, { merge: true });
    batch.set(userRef.collection("consents").doc(), record);
    await batch.commit();
    return { success: true };
  }
);

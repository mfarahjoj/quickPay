import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { ApiResponse } from "../types";

/**
 * Device-integrity signal (ONBOARDING_SECURITY_REVIEW.md B7, E14).
 *
 * App Check proves the app is genuine, not that the phone is. The apps run
 * on-device root/jailbreak and hooking checks at sign-in and report them
 * here. It's a risk signal for ops, never a block: the checks can be wrong,
 * and a determined attacker can hide from them, so refusing service on them
 * would mostly hurt honest people with unusual phones.
 *
 * users/{uid}.deviceRisk keeps the latest report (shown in the console);
 * the appended deviceRiskReports keep the history.
 */
interface RiskReport {
  rooted?: boolean;
  hooked?: boolean;
  debugged?: boolean;
  platform?: string;
  app?: string;
}

export const reportDeviceRisk = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<RiskReport>): Promise<ApiResponse> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const d = request.data ?? {};
    const report = {
      rooted: d.rooted === true,
      hooked: d.hooked === true,
      debugged: d.debugged === true,
      platform: typeof d.platform === "string" ? d.platform.slice(0, 16) : "unknown",
      app: typeof d.app === "string" ? d.app.slice(0, 16) : "unknown",
      at: admin.firestore.Timestamp.now(),
    };
    const flagged = report.rooted || report.hooked;
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const batch = db.batch();
    // Runs at sign-in, maybe before the account is set up. Never create the
    // user doc here: setupPin owns that.
    if ((await userRef.get()).exists) {
      batch.update(userRef, { deviceRisk: { ...report, flagged } });
    }
    // Only worth a history entry when something was found.
    if (flagged) batch.set(db.collection("deviceRiskReports").doc(), { uid, ...report });
    await batch.commit();
    return { success: true };
  }
);

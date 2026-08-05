/**
 * Support lookup for the admin console.
 *
 * The console reads customer records through these callables rather than
 * Firestore directly, so `firestore.rules` stays closed and every look at a
 * customer's record is authorised and — for the full detail view — audited.
 *
 * `pinHash` is stripped on the way out. It is a bcrypt hash rather than a PIN,
 * but there is no reason for it to leave the backend, and an offline attack on
 * a 6-digit PIN is cheap.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry, writeAuditEntry } from "./audit";
import { resolveAccountStatus } from "../utils/accountStatus";

const SENSITIVE_FIELDS = ["pinHash"];

function scrub(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const copy = { ...data };
  for (const field of SENSITIVE_FIELDS) delete copy[field];
  return copy;
}

interface SearchRequest {
  query: string;
}

interface UserSummary {
  userId: string;
  fullName?: string;
  phoneNumber?: string;
  accountType?: string;
  accountStatus: string;
  kycStatus?: string;
}

function toSummary(doc: FirebaseFirestore.DocumentSnapshot): UserSummary {
  const data = doc.data() ?? {};
  return {
    userId: doc.id,
    fullName: data.fullName,
    phoneNumber: data.phoneNumber,
    accountType: data.accountType,
    accountStatus: resolveAccountStatus(data),
    kycStatus: data.kycStatus,
  };
}

/**
 * Find a customer by phone number, uid or name prefix.
 *
 * Phone and uid are exact; name is a prefix scan, which is all Firestore does
 * without a search index.
 */
export const adminSearchUsers = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<SearchRequest>
  ): Promise<ApiResponse<UserSummary[]>> => {
    requireAdmin(request, ["ops", "compliance"]);

    const raw = request.data?.query;
    if (typeof raw !== "string" || raw.trim().length < 3) {
      throw new https.HttpsError(
        "invalid-argument",
        "Enter at least 3 characters to search"
      );
    }

    const query = raw.trim();
    const db = admin.firestore();

    if (query.startsWith("+")) {
      const snap = await db
        .collection("users")
        .where("phoneNumber", "==", query)
        .limit(10)
        .get();
      return { success: true, data: snap.docs.map(toSummary) };
    }

    // A uid is an opaque token with no spaces; try it as a document id before
    // falling back to a name scan.
    if (!query.includes(" ") && query.length >= 20) {
      const direct = await db.collection("users").doc(query).get();
      if (direct.exists) {
        return { success: true, data: [toSummary(direct)] };
      }
    }

    // Note: endAt appends U+F8FF (invisible here) — it sorts after any
    // realistic name character, which is what makes this a prefix scan
    // rather than an exact match. Do not "clean up" that character.
    const snap = await db
      .collection("users")
      .orderBy("fullName")
      .startAt(query)
      .endAt(`${query}`)
      .limit(20)
      .get();

    return { success: true, data: snap.docs.map(toSummary) };
  }
);

interface GetUserRequest {
  userId: string;
}

/** Everything support needs about one customer, in one round trip. */
export const adminGetUser = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<GetUserRequest>
  ): Promise<ApiResponse<Record<string, unknown>>> => {
    const actor = requireAdmin(request, ["ops", "compliance"]);

    const { userId } = request.data ?? {};
    if (typeof userId !== "string" || !userId.trim()) {
      throw new https.HttpsError("invalid-argument", "userId is required");
    }

    const db = admin.firestore();
    const [userSnap, walletSnap, txSnap, deviceSnap, kycSnap] = await Promise.all([
      db.collection("users").doc(userId).get(),
      db.collection("wallets").doc(userId).get(),
      db
        .collection("transactions")
        .where("participants", "array-contains", userId)
        .orderBy("createdAt", "desc")
        .limit(25)
        .get(),
      db.collection("trustedDevices").where("uid", "==", userId).get(),
      db.collection("users").doc(userId).collection("kyc").doc("latest").get(),
    ]);

    if (!userSnap.exists) {
      throw new https.HttpsError("not-found", "User not found");
    }

    const userData = userSnap.data()!;

    // Opening a customer's full record is worth a trail even though it changes
    // nothing — it is how misuse of support access gets noticed.
    writeAuditEntry({
      actor,
      action: "user.view",
      target: { type: "user", id: userId },
      reason: "Support lookup",
    }).catch((err) => console.error("Failed to write view audit:", err));

    return {
      success: true,
      data: {
        userId,
        profile: scrub(userData),
        accountStatus: resolveAccountStatus(userData),
        hasPin: typeof userData.pinHash === "string" && userData.pinHash.length > 0,
        wallet: walletSnap.exists ? walletSnap.data() : null,
        kyc: kycSnap.exists ? kycSnap.data() : null,
        trustedDeviceCount: deviceSnap.size,
        transactions: txSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      },
    };
  }
);

interface SupportActionRequest {
  userId: string;
  reason: string;
}

/**
 * Clear PIN and agent-code lockouts.
 *
 * The common support call: a customer locked themselves out and cannot wait
 * out the backoff.
 */
export const adminClearLockouts = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<SupportActionRequest>
  ): Promise<ApiResponse<{ auditId: string }>> => {
    const actor = requireAdmin(request, "ops");
    requireRecentAdminAuth(request);

    const { userId } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof userId !== "string" || !userId.trim()) {
      throw new https.HttpsError("invalid-argument", "userId is required");
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);

    const auditId = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }
      const before = snap.data()!;

      tx.update(userRef, {
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        agentOtpFailedAttempts: 0,
        agentOtpLockedUntil: null,
        updatedAt: admin.firestore.Timestamp.now(),
      });

      return stageAuditEntry(tx, {
        actor,
        action: "user.clearLockouts",
        target: { type: "user", id: userId },
        reason,
        before: {
          pinFailedAttempts: before.pinFailedAttempts ?? 0,
          pinLockedUntil: before.pinLockedUntil ?? null,
          agentOtpFailedAttempts: before.agentOtpFailedAttempts ?? 0,
        },
        after: { pinFailedAttempts: 0, pinLockedUntil: null, agentOtpFailedAttempts: 0 },
      });
    });

    return { success: true, message: "Lockouts cleared", data: { auditId } };
  }
);

/**
 * De-register every trusted device for a customer.
 *
 * Used when a handset is lost or a session is suspected stolen: the device
 * secret can be exchanged with the PIN for a session, so revoking is the
 * cut-off.
 */
export const adminRevokeUserDevices = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<SupportActionRequest>
  ): Promise<ApiResponse<{ revoked: number; auditId: string }>> => {
    const actor = requireAdmin(request, "ops");
    requireRecentAdminAuth(request);

    const { userId } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof userId !== "string" || !userId.trim()) {
      throw new https.HttpsError("invalid-argument", "userId is required");
    }

    const db = admin.firestore();
    const snap = await db
      .collection("trustedDevices")
      .where("uid", "==", userId)
      .get();

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    const auditId = await writeAuditEntry({
      actor,
      action: "user.revokeDevices",
      target: { type: "user", id: userId },
      reason,
      before: { trustedDeviceCount: snap.size },
      after: { trustedDeviceCount: 0 },
    });

    return {
      success: true,
      message: `Revoked ${snap.size} device(s)`,
      data: { revoked: snap.size, auditId },
    };
  }
);

/**
 * Ledger health for the console banner.
 *
 * Per-account drift cannot be derived on demand — that needs a full journal
 * replay — so the console reports what the scheduled invariant job last found.
 */
export const adminGetLedgerHealth = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<void>
  ): Promise<ApiResponse<Record<string, unknown>>> => {
    requireAdmin(request);

    const db = admin.firestore();
    const [checkpoints, alerts] = await Promise.all([
      db.collection("ledger_checkpoints").orderBy("ranAt", "desc").limit(1).get(),
      db.collection("ledger_alerts").where("acknowledged", "==", false).limit(5).get(),
    ]);

    const latest = checkpoints.empty ? null : checkpoints.docs[0].data();

    return {
      success: true,
      data: {
        lastRun: latest,
        neverRun: checkpoints.empty,
        openAlertCount: alerts.size,
        openAlerts: alerts.docs.map((d) => ({ id: d.id, ...d.data() })),
      },
    };
  }
);

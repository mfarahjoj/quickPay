/**
 * Applying for a privileged role.
 *
 * Privileged roles (`merchant`, `topup_agent`, `agent_merchant`) can no longer
 * be self-selected: every account is created as `customer` and an admin has to
 * approve the upgrade. See ADMIN_CONSOLE_PLAN.md §4.1.
 *
 * Request documents are keyed `{userId}_{role}`, so re-applying after a
 * rejection reuses the same document rather than piling up duplicates. The
 * history of who decided what lives in `admin_audit`, which is append-only.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, sanitizeString } from "../utils/validation";
import { isPrivilegedRole } from "../utils/roles";
import { ApiResponse, PrivilegedRole, RoleRequest } from "../types";

export const ROLE_REQUESTS_COLLECTION = "roleRequests";

export function roleRequestId(userId: string, role: PrivilegedRole): string {
  return `${userId}_${role}`;
}

export interface RoleRequestDetails {
  businessName?: string;
  area?: string;
  note?: string;
}

export interface EnsureRoleRequestResult {
  requestId: string;
  status: RoleRequest["status"];
  /** False when a pending or approved request already existed. */
  created: boolean;
}

/**
 * Record an application for a privileged role.
 *
 * Idempotent by design: callers include signup flows that may retry. An
 * already-approved request is returned untouched so an approval can never be
 * reset to pending by a stray client call.
 */
export async function ensureRoleRequest(
  db: admin.firestore.Firestore,
  userId: string,
  role: PrivilegedRole,
  details: RoleRequestDetails = {}
): Promise<EnsureRoleRequestResult> {
  const requestId = roleRequestId(userId, role);
  const ref = db.collection(ROLE_REQUESTS_COLLECTION).doc(requestId);
  const existing = await ref.get();

  if (existing.exists) {
    const current = existing.data() as RoleRequest;
    if (current.status === "pending" || current.status === "approved") {
      return { requestId, status: current.status, created: false };
    }
  }

  const payload: Record<string, unknown> = {
    userId,
    requestedRole: role,
    status: "pending",
    createdAt: admin.firestore.Timestamp.now(),
    // A re-application must clear the previous verdict, or the console would
    // show a pending row still carrying the old reviewer and reason.
    reviewedBy: admin.firestore.FieldValue.delete(),
    reviewedAt: admin.firestore.FieldValue.delete(),
    reason: admin.firestore.FieldValue.delete(),
  };

  if (details.businessName) payload.businessName = sanitizeString(details.businessName);
  if (details.area) payload.area = sanitizeString(details.area);
  if (details.note) payload.note = sanitizeString(details.note);

  await ref.set(payload, { merge: true });

  return { requestId, status: "pending", created: true };
}

interface RequestRoleRequest {
  requestedRole: PrivilegedRole;
  businessName?: string;
  area?: string;
  note?: string;
}

/**
 * Callable: apply for a privileged role.
 *
 * Used by the merchant app when someone picks a role during onboarding, and
 * by an existing customer who later wants to accept payments.
 */
export const requestRole = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RequestRoleRequest>
  ): Promise<ApiResponse<EnsureRoleRequestResult & { alreadyHeld?: boolean }>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const { requestedRole, businessName, area, note } = request.data ?? {};

    if (!isPrivilegedRole(requestedRole)) {
      throw new https.HttpsError(
        "invalid-argument",
        "requestedRole must be merchant, topup_agent or agent_merchant"
      );
    }

    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(userId).get();

    if (!userSnap.exists) {
      throw new https.HttpsError(
        "failed-precondition",
        "Complete your profile before applying for a merchant or agent role"
      );
    }

    if (userSnap.data()?.accountType === requestedRole) {
      return {
        success: true,
        message: "You already hold this role",
        data: {
          requestId: roleRequestId(userId, requestedRole),
          status: "approved",
          created: false,
          alreadyHeld: true,
        },
      };
    }

    const result = await ensureRoleRequest(db, userId, requestedRole, {
      businessName,
      area,
      note,
    });

    return {
      success: true,
      message:
        result.status === "approved"
          ? "This role has already been approved"
          : "Your application is pending review",
      data: result,
    };
  }
);

/**
 * Callable: read your own role applications.
 *
 * `roleRequests` is server-only in the rules, so the apps need this to show
 * "pending review" rather than silently looking like nothing happened.
 */
export const getMyRoleRequests = https.onCall(
  async (
    request: https.CallableRequest<void>
  ): Promise<ApiResponse<Array<RoleRequest & { requestId: string }>>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const snap = await admin
      .firestore()
      .collection(ROLE_REQUESTS_COLLECTION)
      .where("userId", "==", userId)
      .get();

    const requests = snap.docs.map((doc) => ({
      requestId: doc.id,
      ...(doc.data() as RoleRequest),
    }));

    return { success: true, data: requests };
  }
);

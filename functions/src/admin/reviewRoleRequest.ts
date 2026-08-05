/**
 * Reviewing applications for privileged roles.
 *
 * This is the gate that replaces self-selection: until an admin approves,
 * an applicant stays a `customer` and cannot take payments or issue float.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, RoleRequest, RoleRequestStatus } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { ensureMerchantProfile } from "../merchants/profile";
import { isMerchantRole } from "../utils/roles";
import { ROLE_REQUESTS_COLLECTION } from "../merchants/requestRole";
import { notifyUser } from "../utils/notifications";

interface ListRoleRequestsRequest {
  status?: RoleRequestStatus;
  limit?: number;
}

interface RoleRequestRow extends RoleRequest {
  requestId: string;
  applicantName?: string;
  applicantPhone?: string;
  currentAccountType?: string;
}

const MAX_LIMIT = 200;

/** Callable: the review queue. */
export const adminListRoleRequests = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ListRoleRequestsRequest>
  ): Promise<ApiResponse<RoleRequestRow[]>> => {
    requireAdmin(request, "compliance");

    const status = request.data?.status ?? "pending";
    const limit = Math.min(Math.max(request.data?.limit ?? 50, 1), MAX_LIMIT);

    const db = admin.firestore();
    const snap = await db
      .collection(ROLE_REQUESTS_COLLECTION)
      .where("status", "==", status)
      .limit(limit)
      .get();

    if (snap.empty) return { success: true, data: [] };

    // Enrich with applicant details so the reviewer is not cross-referencing
    // uids by hand. Batched to one read per applicant.
    const userSnaps = await db.getAll(
      ...snap.docs.map((d) =>
        db.collection("users").doc((d.data() as RoleRequest).userId)
      )
    );
    const usersById = new Map(
      userSnaps.filter((u) => u.exists).map((u) => [u.id, u.data()!])
    );

    const rows: RoleRequestRow[] = snap.docs.map((doc) => {
      const data = doc.data() as RoleRequest;
      const user = usersById.get(data.userId);
      return {
        requestId: doc.id,
        ...data,
        applicantName: user?.fullName,
        applicantPhone: user?.phoneNumber,
        currentAccountType: user?.accountType,
      };
    });

    return { success: true, data: rows };
  }
);

interface ReviewRoleRequestRequest {
  requestId: string;
  decision: "approve" | "reject";
  reason: string;
}

/** Callable: approve or reject an application. */
export const adminReviewRoleRequest = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ReviewRoleRequestRequest>
  ): Promise<ApiResponse<{ requestId: string; status: RoleRequestStatus; auditId: string }>> => {
    const actor = requireAdmin(request, "compliance");
    requireRecentAdminAuth(request);

    const { requestId, decision } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof requestId !== "string" || !requestId.trim()) {
      throw new https.HttpsError("invalid-argument", "requestId is required");
    }
    if (decision !== "approve" && decision !== "reject") {
      throw new https.HttpsError(
        "invalid-argument",
        "decision must be 'approve' or 'reject'"
      );
    }

    const db = admin.firestore();
    const requestRef = db.collection(ROLE_REQUESTS_COLLECTION).doc(requestId);

    const outcome = await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) {
        throw new https.HttpsError("not-found", "Role request not found");
      }

      const roleRequest = requestSnap.data() as RoleRequest;

      if (roleRequest.status !== "pending") {
        throw new https.HttpsError(
          "failed-precondition",
          `This request was already ${roleRequest.status}`
        );
      }

      const userRef = db.collection("users").doc(roleRequest.userId);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new https.HttpsError("not-found", "Applicant no longer exists");
      }

      const previousAccountType = userSnap.data()?.accountType ?? "customer";
      const now = admin.firestore.Timestamp.now();
      const status: RoleRequestStatus =
        decision === "approve" ? "approved" : "rejected";

      tx.update(requestRef, {
        status,
        reviewedBy: actor.uid,
        reviewedAt: now,
        reason,
      });

      if (decision === "approve") {
        tx.update(userRef, {
          accountType: roleRequest.requestedRole,
          updatedAt: now,
        });
      } else if (previousAccountType === roleRequest.requestedRole) {
        // Rejecting an account that already holds the role demotes it. This is
        // how the migration closes: accounts that self-selected a role before
        // the gate existed are backfilled as pending, and rejecting one
        // actually takes the role away rather than leaving it in place.
        tx.update(userRef, { accountType: "customer", updatedAt: now });
      }

      const auditId = stageAuditEntry(tx, {
        actor,
        action: decision === "approve" ? "role.approve" : "role.reject",
        target: { type: "role_request", id: requestId },
        reason,
        before: { accountType: previousAccountType, status: "pending" },
        after: {
          accountType:
            decision === "approve"
              ? roleRequest.requestedRole
              : previousAccountType === roleRequest.requestedRole
                ? "customer"
                : previousAccountType,
          status,
        },
      });

      return {
        auditId,
        status,
        userId: roleRequest.userId,
        requestedRole: roleRequest.requestedRole,
        businessName: roleRequest.businessName,
      };
    });

    // Profile creation and notification sit outside the transaction: both are
    // idempotent, and neither should be able to roll back a decision.
    if (outcome.status === "approved" && isMerchantRole(outcome.requestedRole)) {
      const userSnap = await db.collection("users").doc(outcome.userId).get();
      const businessName =
        outcome.businessName || userSnap.data()?.fullName || "Merchant";
      await ensureMerchantProfile(db, outcome.userId, businessName).catch((err) =>
        console.error("Failed to ensure merchant profile:", err)
      );
    }

    const approved = outcome.status === "approved";
    notifyUser(
      outcome.userId,
      approved ? "role_approved" : "role_rejected",
      approved ? "Account upgraded" : "Application not approved",
      approved
        ? `You can now use Zapp Pay as a ${outcome.requestedRole.replace("_", " ")}.`
        : `Your application was not approved. ${reason}`,
      { requestId, role: outcome.requestedRole }
    ).catch((err) => console.error("Failed to notify applicant:", err));

    console.log(
      `Role request ${requestId} ${outcome.status} by ${actor.uid} (${actor.email})`
    );

    return {
      success: true,
      message: approved ? "Role approved" : "Role rejected",
      data: { requestId, status: outcome.status, auditId: outcome.auditId },
    };
  }
);

/**
 * Reviewing applications for privileged roles.
 *
 * This is the gate that replaces self-selection: until an admin approves,
 * an applicant stays a `customer` and cannot take payments or issue float.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, KycDocument, RoleRequest, RoleRequestStatus } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { ensureMerchantProfile } from "../merchants/profile";
import { isAgentRole, isMerchantRole } from "../utils/roles";
import { maybeUnlockReferral } from "../referral/referralBonus";
import { ZAAD_AGENTS, type ZaadAgentDoc } from "../zaadAgent/types";
import { ROLE_REQUESTS_COLLECTION } from "../merchants/requestRole";
import { notifyUser } from "../utils/notifications";
import { ROLE_NAMES } from "../utils/pushTemplates";
import { signImage, type SignedImage } from "./kycReview";
import { writeAuditEntry } from "./audit";

interface ListRoleRequestsRequest {
  status?: RoleRequestStatus;
  limit?: number;
}

interface RoleRequestRow extends RoleRequest {
  requestId: string;
  applicationSubmitted?: boolean;
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
        // The application itself stays out of the list; the review view
        // fetches it with signed photo links.
        application: undefined,
        previousApplication: undefined,
        applicationSubmitted: !!data.application,
      };
    });

    return { success: true, data: rows };
  }
);

interface ReviewRoleRequestRequest {
  requestId: string;
  decision: "approve" | "reject";
  reason: string;
  /**
   * The ID number the reviewer checked in person, on approval. Kept
   * server-only (users/{uid}/private/identity) so a merchant can later reset
   * a forgotten PIN with its last four, as with a verified KYC ID (review O5).
   */
  idNumber?: string;
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
    const rawId = request.data?.idNumber;
    const idNumber =
      decision === "approve" && typeof rawId === "string" ? rawId.replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "";
    if (rawId !== undefined && rawId !== "" && idNumber.length < 4) {
      throw new https.HttpsError("invalid-argument", "The ID number needs at least 4 letters or digits");
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

      // A full application from the merchant app is applied on approval, so
      // the reviewer decides once and nothing is left to chase. All reads
      // happen here, before any write, as a transaction requires.
      const application = roleRequest.application;
      const role = roleRequest.requestedRole;
      const kycRef = userRef.collection("kyc").doc("latest");
      const kycDoc = application?.includesId ? ((await tx.get(kycRef)).data() as KycDocument | undefined) : undefined;
      const kycFromApplication = kycDoc?.status === "submitted" && kycDoc.source === "role_application";
      const zaadNumber = isAgentRole(role) ? application?.agent?.zaadReceiveNumber : undefined;
      const zaadRef = db.collection(ZAAD_AGENTS).doc(roleRequest.userId);
      let zaadPrev: ZaadAgentDoc | undefined;
      if (decision === "approve" && zaadNumber) {
        const taken = await tx.get(db.collection(ZAAD_AGENTS).where("receiveMsisdn", "==", zaadNumber).limit(5));
        if (taken.docs.some((d) => d.id !== roleRequest.userId)) {
          throw new https.HttpsError(
            "failed-precondition",
            "Another agent already receives on this Zaad number. Reject and ask the applicant for their own number."
          );
        }
        zaadPrev = (await tx.get(zaadRef)).data() as ZaadAgentDoc | undefined;
      }
      const merchantRef = db.collection("merchantProfiles").doc(roleRequest.userId);
      const merchantExists =
        decision === "approve" && application && isMerchantRole(role) ? (await tx.get(merchantRef)).exists : false;
      const status: RoleRequestStatus =
        decision === "approve" ? "approved" : "rejected";

      tx.update(requestRef, {
        status,
        reviewedBy: actor.uid,
        reviewedAt: now,
        reason,
      });

      // Mirror the verdict onto the user doc so the apps' existing live
      // listener reacts immediately (see ensureRoleRequest).
      tx.update(userRef, {
        roleRequestStatus: status,
        roleRequestReason: decision === "reject" ? reason : admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });

      if (decision === "approve") {
        tx.update(userRef, {
          accountType: roleRequest.requestedRole,
          updatedAt: now,
        });
        // The ID the reviewer typed wins; otherwise the one on the documents
        // they just checked.
        const checkedId =
          idNumber ||
          (kycFromApplication ? String(kycDoc!.idNumber ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "");
        if (checkedId.length >= 4) {
          tx.set(userRef.collection("private").doc("identity"), {
            idNumber: checkedId,
            source: "role_review",
            recordedBy: actor.uid,
            recordedAt: now,
          });
        }

        if (application) {
          if (kycFromApplication) {
            tx.update(kycRef, { status: "verified", reviewedAt: now, reviewedBy: actor.uid });
            tx.update(userRef, { kycStatus: "verified" });
          }
          if (isMerchantRole(role) && application.payout) {
            const { provider, number } = application.payout;
            tx.set(
              merchantRef,
              {
                businessName: application.businessName,
                businessType: application.businessType,
                businessAddress: application.businessAddress,
                area: application.area,
                location: application.location ?? null,
                shopPhotoPath: application.shopPhotoPath,
                settlementPreference: provider,
                ...(provider === "zaad" ? { zaadAccount: number } : { edahabAccount: number }),
                ...(merchantExists ? {} : { minimumSettlementAmount: 1000 }),
              },
              { merge: true }
            );
          }
          if (isAgentRole(role) && application.agent) {
            tx.update(userRef, {
              agentInfo: {
                area: application.area,
                openHours: application.agent.openHours,
                services: application.agent.services,
                isActive: true,
                businessName: application.businessName,
                ...(application.location ? { location: application.location } : {}),
              },
            });
          }
          if (zaadNumber) {
            // As adminSetZaadAgent records it: the reviewer has checked the
            // number against the applicant's ID and switches them on.
            const next: ZaadAgentDoc = {
              receiveMsisdn: zaadNumber,
              verifiedBy: actor.uid,
              verifiedAt: now,
              enabled: true,
              pausedUntil: zaadPrev?.pausedUntil ?? null,
              online: zaadPrev?.online ?? false,
              lastSeenAt: zaadPrev?.lastSeenAt ?? null,
              openRequestIds: zaadPrev?.openRequestIds ?? [],
              openRequestId: zaadPrev?.openRequestId ?? null,
              lastOfferedAt: zaadPrev?.lastOfferedAt ?? null,
              missedOffers: zaadPrev?.missedOffers ?? 0,
            };
            tx.set(zaadRef, next);
          }
        }
      } else if (previousAccountType === roleRequest.requestedRole) {
        // Rejecting an account that already holds the role demotes it. This is
        // how the migration closes: accounts that self-selected a role before
        // the gate existed are backfilled as pending, and rejecting one
        // actually takes the role away rather than leaving it in place.
        tx.update(userRef, { accountType: "customer", updatedAt: now });
      }

      // The ID came in with the application, so it shares the verdict: a
      // rejected applicant resubmits it with the rest.
      if (decision === "reject" && kycFromApplication) {
        tx.update(kycRef, { status: "rejected", reviewedAt: now, reviewedBy: actor.uid, rejectionReason: reason });
        tx.update(userRef, { kycStatus: "rejected" });
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
          ...(application
            ? {
                applied: {
                  kycVerified: decision === "approve" && kycFromApplication,
                  merchantProfile: decision === "approve" && isMerchantRole(role) && !!application.payout,
                  agentSetUp: decision === "approve" && isAgentRole(role) && !!application.agent,
                  zaadReceiveNumber: decision === "approve" ? zaadNumber ?? null : null,
                },
              }
            : {}),
        },
      });

      return {
        auditId,
        status,
        userId: roleRequest.userId,
        requestedRole: roleRequest.requestedRole,
        businessName: roleRequest.businessName,
        hasApplication: !!application,
        kycVerified: decision === "approve" && kycFromApplication,
      };
    });

    // Profile creation and notification sit outside the transaction: both are
    // idempotent, and neither should be able to roll back a decision.
    if (outcome.kycVerified) {
      await maybeUnlockReferral(outcome.userId, { kind: "kyc_verified" }).catch((err) =>
        console.error("Failed to unlock referral:", err)
      );
    }

    // An application already wrote the full profile in the transaction.
    if (outcome.status === "approved" && isMerchantRole(outcome.requestedRole) && !outcome.hasApplication) {
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
      approved
        ? { key: "role.approved", params: { role: ROLE_NAMES[outcome.requestedRole] ?? outcome.requestedRole } }
        : { key: "role.rejected", params: { reason } },
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

/**
 * Callable: one application with everything needed to decide it, photos as
 * 15-minute signed links (never the stored references).
 */
export const adminGetRoleApplication = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ requestId: string }>
  ): Promise<ApiResponse<Record<string, unknown>>> => {
    const actor = requireAdmin(request, "compliance");
    const requestId = request.data?.requestId;
    if (typeof requestId !== "string" || !requestId.trim()) {
      throw new https.HttpsError("invalid-argument", "requestId is required");
    }

    const db = admin.firestore();
    const snap = await db.collection(ROLE_REQUESTS_COLLECTION).doc(requestId).get();
    if (!snap.exists) throw new https.HttpsError("not-found", "Role request not found");
    const roleRequest = snap.data() as RoleRequest;
    const userId = roleRequest.userId;

    const [userSnap, kycSnap] = await Promise.all([
      db.collection("users").doc(userId).get(),
      db.collection("users").doc(userId).collection("kyc").doc("latest").get(),
    ]);
    const user = userSnap.data() ?? {};
    const kyc = kycSnap.data() as KycDocument | undefined;
    const application = roleRequest.application;

    const images: SignedImage[] = [];
    if (application?.shopPhotoPath) images.push(await signImage("shop", application.shopPhotoPath, null, userId));
    if (kyc) {
      images.push(await signImage("front", kyc.frontPhotoUrl, kyc.frontPhotoPath, userId));
      if (kyc.backPhotoUrl || kyc.backPhotoPath) {
        images.push(await signImage("back", kyc.backPhotoUrl, kyc.backPhotoPath, userId));
      }
      images.push(await signImage("selfie", kyc.selfieUrl, kyc.selfiePath, userId));
    }

    // Opening someone's ID photos is worth a record, as on the KYC desk.
    if (kyc) {
      await writeAuditEntry({
        actor,
        action: "role.view_application",
        target: { type: "role_request", id: requestId },
        reason: "Opened the application to review it",
      }).catch((err) => console.error("Failed to audit application view:", err));
    }

    const ms = (ts?: FirebaseFirestore.Timestamp | null) => (ts ? ts.toMillis() : null);
    return {
      success: true,
      data: {
        requestId,
        userId,
        requestedRole: roleRequest.requestedRole,
        status: roleRequest.status,
        createdAt: ms(roleRequest.createdAt),
        applicant: {
          fullName: user.fullName ?? null,
          phoneNumber: user.phoneNumber ?? null,
          accountType: user.accountType ?? "customer",
          accountStatus: user.accountStatus ?? "active",
          kycStatus: user.kycStatus ?? null,
        },
        application: application ? { ...application, submittedAt: ms(application.submittedAt) } : null,
        kyc: kyc
          ? {
              idType: kyc.idType,
              idNumber: kyc.idNumber,
              status: kyc.status,
              fromApplication: kyc.source === "role_application",
            }
          : null,
        images,
      },
    };
  }
);

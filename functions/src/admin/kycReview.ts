/**
 * KYC review queue.
 *
 * Until now `submitKYC` collected documents and nothing could ever approve
 * them: every applicant sat at `kycStatus: "submitted"` forever, which made
 * the KYC-tiered transaction caps decorative.
 *
 * ID photos never leave here as durable links. The stored `*PhotoUrl` fields
 * are `getDownloadURL()` results — permanent and unauthenticated — so the
 * reviewer is given 15-minute signed URLs minted from the object path instead.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse, KycDocument, KycStatus } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry, writeAuditEntry } from "./audit";
import { parseStorageRef, isKycPathFor } from "../utils/storagePaths";
import { resolveAccountStatus } from "../utils/accountStatus";
import { notifyUser } from "../utils/notifications";

/** Long enough to review a submission, short enough that a leak expires. */
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

interface ListKycRequest {
  status?: KycStatus;
  limit?: number;
}

interface KycQueueRow {
  userId: string;
  idType?: string;
  status?: string;
  submittedAt?: FirebaseFirestore.Timestamp;
  applicantName?: string;
  applicantPhone?: string;
  accountType?: string;
}

/**
 * The review queue, oldest first — someone waiting three days should not be
 * behind someone who submitted this morning.
 */
export const adminListKycQueue = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ListKycRequest>
  ): Promise<ApiResponse<KycQueueRow[]>> => {
    requireAdmin(request, "compliance");

    const status = request.data?.status ?? "submitted";
    const limit = Math.min(Math.max(request.data?.limit ?? 50, 1), 200);

    const db = admin.firestore();

    // Collection group over every users/{uid}/kyc/latest, so there is no
    // duplicate queue collection to keep in sync with the source of truth.
    const snap = await db
      .collectionGroup("kyc")
      .where("status", "==", status)
      .orderBy("submittedAt", "asc")
      .limit(limit)
      .get();

    if (snap.empty) return { success: true, data: [] };

    // The parent of users/{uid}/kyc/latest is the kyc collection; its parent
    // is the user document.
    const userIds = snap.docs.map((doc) => doc.ref.parent.parent!.id);
    const userSnaps = await db.getAll(
      ...userIds.map((uid) => db.collection("users").doc(uid))
    );
    const usersById = new Map(
      userSnaps.filter((u) => u.exists).map((u) => [u.id, u.data()!])
    );

    const rows: KycQueueRow[] = snap.docs.map((doc, i) => {
      const kyc = doc.data() as KycDocument;
      const userId = userIds[i];
      const user = usersById.get(userId);
      return {
        userId,
        idType: kyc.idType,
        status: kyc.status,
        submittedAt: kyc.submittedAt,
        applicantName: user?.fullName,
        applicantPhone: user?.phoneNumber,
        accountType: user?.accountType,
      };
    });

    return { success: true, data: rows };
  }
);

interface GetKycRequest {
  userId: string;
}

interface SignedImage {
  label: "front" | "back" | "selfie";
  url?: string;
  /** Why the image could not be shown, when it could not. */
  error?: string;
}

/**
 * Mint a short-lived read URL for one stored image reference.
 *
 * Returns an error string rather than the raw stored URL on any failure:
 * handing back the permanent download link is exactly what this avoids.
 */
async function signImage(
  label: SignedImage["label"],
  storedRef: unknown,
  pathHint: unknown,
  userId: string
): Promise<SignedImage> {
  const parsed = parseStorageRef(pathHint) ?? parseStorageRef(storedRef);
  if (!parsed) {
    return { label, error: "No resolvable storage path for this image" };
  }
  if (!isKycPathFor(parsed.path, userId)) {
    // The reference came from a document the applicant influenced; it must not
    // be usable to read arbitrary objects.
    console.warn(
      `KYC image path outside the applicant's folder: ${parsed.path} (user ${userId})`
    );
    return { label, error: "Image path is outside this applicant's folder" };
  }

  try {
    const bucket = parsed.bucket
      ? admin.storage().bucket(parsed.bucket)
      : admin.storage().bucket();
    const [url] = await bucket.file(parsed.path).getSignedUrl({
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return { label, url };
  } catch (err) {
    // Signing needs the service account to have iam.serviceAccountTokenCreator.
    console.error(`Failed to sign KYC image ${parsed.path}:`, err);
    return {
      label,
      error:
        "Could not generate a signed link. The functions service account may " +
        "need the Service Account Token Creator role.",
    };
  }
}

/** One submission, with everything needed to decide on it. */
export const adminGetKycSubmission = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<GetKycRequest>
  ): Promise<ApiResponse<Record<string, unknown>>> => {
    const actor = requireAdmin(request, "compliance");

    const { userId } = request.data ?? {};
    if (typeof userId !== "string" || !userId.trim()) {
      throw new https.HttpsError("invalid-argument", "userId is required");
    }

    const db = admin.firestore();
    const [userSnap, kycSnap, walletSnap] = await Promise.all([
      db.collection("users").doc(userId).get(),
      db.collection("users").doc(userId).collection("kyc").doc("latest").get(),
      db.collection("wallets").doc(userId).get(),
    ]);

    if (!userSnap.exists) {
      throw new https.HttpsError("not-found", "User not found");
    }
    if (!kycSnap.exists) {
      throw new https.HttpsError("not-found", "No KYC submission for this user");
    }

    const kyc = kycSnap.data() as KycDocument;
    const user = userSnap.data()!;

    const images = await Promise.all([
      signImage("front", kyc.frontPhotoUrl, kyc.frontPhotoPath, userId),
      signImage("back", kyc.backPhotoUrl, kyc.backPhotoPath, userId),
      signImage("selfie", kyc.selfieUrl, kyc.selfiePath, userId),
    ]);

    // Viewing someone's identity documents is worth a trail on its own.
    writeAuditEntry({
      actor,
      action: "kyc.view",
      target: { type: "kyc", id: userId },
      reason: "KYC review",
    }).catch((err) => console.error("Failed to write KYC view audit:", err));

    return {
      success: true,
      data: {
        userId,
        idType: kyc.idType,
        idNumber: kyc.idNumber,
        status: kyc.status,
        submittedAt: kyc.submittedAt,
        reviewedAt: kyc.reviewedAt ?? null,
        rejectionReason: kyc.rejectionReason ?? null,
        // `back` is optional on some ID types; drop it when absent rather than
        // showing the reviewer a broken slot.
        images: images.filter(
          (img) => img.label !== "back" || img.url || kyc.backPhotoUrl
        ),
        applicant: {
          fullName: user.fullName,
          phoneNumber: user.phoneNumber,
          accountType: user.accountType,
          accountStatus: resolveAccountStatus(user),
          kycStatus: user.kycStatus,
          dateOfBirth: user.dateOfBirth ?? null,
        },
        wallet: walletSnap.exists
          ? {
              balance: walletSnap.data()?.balance ?? 0,
              currency: walletSnap.data()?.currency ?? "USD",
            }
          : null,
      },
    };
  }
);

interface ReviewKycRequest {
  userId: string;
  decision: "approve" | "reject";
  reason: string;
}

/**
 * Approve or reject a submission.
 *
 * Approval sets `users.kycStatus` to `verified`, which is the field the
 * per-transaction caps read. Rejection sets `rejected` and keeps the reason,
 * which the applicant is shown so they can resubmit correctly.
 */
export const adminReviewKyc = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ReviewKycRequest>
  ): Promise<ApiResponse<{ userId: string; kycStatus: KycStatus; auditId: string }>> => {
    const actor = requireAdmin(request, "compliance");
    requireRecentAdminAuth(request);

    const { userId, decision } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof userId !== "string" || !userId.trim()) {
      throw new https.HttpsError("invalid-argument", "userId is required");
    }
    if (decision !== "approve" && decision !== "reject") {
      throw new https.HttpsError(
        "invalid-argument",
        "decision must be 'approve' or 'reject'"
      );
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const kycRef = userRef.collection("kyc").doc("latest");

    const outcome = await db.runTransaction(async (tx) => {
      const [userSnap, kycSnap] = await Promise.all([tx.get(userRef), tx.get(kycRef)]);

      if (!userSnap.exists) {
        throw new https.HttpsError("not-found", "User not found");
      }
      if (!kycSnap.exists) {
        throw new https.HttpsError("not-found", "No KYC submission for this user");
      }

      const kyc = kycSnap.data() as KycDocument;
      if (kyc.status !== "submitted") {
        throw new https.HttpsError(
          "failed-precondition",
          `This submission was already ${kyc.status}`
        );
      }

      const previousStatus: KycStatus = userSnap.data()?.kycStatus ?? "pending";
      const kycStatus: KycStatus = decision === "approve" ? "verified" : "rejected";
      const now = admin.firestore.Timestamp.now();

      tx.update(kycRef, {
        status: kycStatus,
        reviewedAt: now,
        reviewedBy: actor.uid,
        ...(decision === "reject"
          ? { rejectionReason: reason }
          : { rejectionReason: admin.firestore.FieldValue.delete() }),
      });

      tx.update(userRef, { kycStatus, updatedAt: now });

      const auditId = stageAuditEntry(tx, {
        actor,
        action: decision === "approve" ? "kyc.approve" : "kyc.reject",
        target: { type: "kyc", id: userId },
        reason,
        before: { kycStatus: previousStatus },
        after: { kycStatus },
      });

      return { auditId, kycStatus };
    });

    const approved = outcome.kycStatus === "verified";
    notifyUser(
      userId,
      approved ? "kyc_approved" : "kyc_rejected",
      approved ? "Identity verified" : "Verification unsuccessful",
      approved
        ? "Your identity is verified. Your transaction limits have increased."
        : `We could not verify your documents. ${reason}`,
      { kycStatus: outcome.kycStatus }
    ).catch((err) => console.error("Failed to notify applicant:", err));

    console.log(
      `KYC for ${userId} set to ${outcome.kycStatus} by ${actor.uid} (${actor.email})`
    );

    return {
      success: true,
      message: approved ? "Identity verified" : "Submission rejected",
      data: { userId, kycStatus: outcome.kycStatus, auditId: outcome.auditId },
    };
  }
);

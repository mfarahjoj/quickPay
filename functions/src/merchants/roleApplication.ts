/**
 * The merchant / agent application, sent in one go from the merchant app.
 *
 * Applying used to be a name and a role; the reviewer then had to chase the
 * applicant for ID, payout details and (for agents) hours and a Zaad number,
 * each on a different desk. Now the app collects all of it up front, like a
 * driver sign-up, and approval in the console applies it in one step (see
 * admin/reviewRoleRequest.ts): role, merchant profile, agent set-up and KYC.
 *
 * Nothing here moves value or grants anything: it records what the applicant
 * says, for a person to check.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, sanitizeString } from "../utils/validation";
import { isAgentRole, isMerchantRole, isPrivilegedRole } from "../utils/roles";
import { normaliseSomaliMsisdn } from "../utils/msisdn";
import { normaliseZaadName } from "../auth/zaadAccount";
import { isKycPathFor, parseStorageRef } from "../utils/storagePaths";
import { ROLE_REQUESTS_COLLECTION, roleRequestId } from "./requestRole";
import { AgentService, ApiResponse, GeoPin, KycDocument, PrivilegedRole, RoleApplication, RoleRequest, User, ZaadAccount } from "../types";

const ID_TYPES = ["national_id", "passport", "drivers_license"] as const;
const SERVICES: AgentService[] = ["cash_in", "cash_out"];

export interface SubmitRoleApplicationRequest {
  requestedRole: PrivilegedRole;
  businessName: string;
  businessType: string;
  businessAddress: string;
  area: string;
  location?: GeoPin | null;
  shopPhotoPath: string;
  payout?: { provider: "zaad" | "edahab"; number: string };
  agent?: { openHours?: string; services?: AgentService[]; zaadReceiveNumber?: string };
  /**
   * The full name the Zaad number is registered to. Saves the account's Zaad
   * account (users.zaad, where payouts go) when none is on file, so the app
   * doesn't ask for it again after approval.
   */
  zaadName?: string;
  /** Required unless the account is already KYC-verified. */
  id?: {
    idType: (typeof ID_TYPES)[number];
    idNumber?: string;
    frontPath: string;
    backPath?: string;
    selfiePath: string;
  };
}

/** Optional text: trimmed and capped, "" when absent. */
function optional(value: unknown, max: number): string {
  return typeof value === "string" ? sanitizeString(value).slice(0, max) : "";
}

function text(value: unknown, what: string, min = 2, max = 120): string {
  if (typeof value !== "string" || value.trim().length < min) {
    throw new https.HttpsError("invalid-argument", `${what} is required`);
  }
  return sanitizeString(value).slice(0, max);
}

/** A photo the applicant uploaded to their own KYC folder. */
function photoPath(value: unknown, userId: string, what: string): string {
  const parsed = parseStorageRef(value);
  if (!parsed || !isKycPathFor(parsed.path, userId)) {
    throw new https.HttpsError("invalid-argument", `${what} is missing. Take the photo again.`);
  }
  return parsed.path;
}

function pin(value: unknown): GeoPin | null {
  if (value == null) return null;
  const v = value as Partial<GeoPin>;
  const ok =
    typeof v.lat === "number" &&
    typeof v.lng === "number" &&
    Math.abs(v.lat) <= 90 &&
    Math.abs(v.lng) <= 180 &&
    !(v.lat === 0 && v.lng === 0);
  if (!ok) throw new https.HttpsError("invalid-argument", "The shop location is not valid. Pin it again.");
  return {
    lat: Math.round(v.lat! * 1e6) / 1e6,
    lng: Math.round(v.lng! * 1e6) / 1e6,
    ...(typeof v.accuracyM === "number" && v.accuracyM >= 0 ? { accuracyM: Math.round(v.accuracyM) } : {}),
  };
}

function msisdn(value: unknown, what: string): string {
  const n = normaliseSomaliMsisdn(typeof value === "string" ? value : null);
  if (!n) throw new https.HttpsError("invalid-argument", `${what}: enter a number like 063 412 3456`);
  return n;
}

/** Validates the request into what is stored. Exported for tests. */
export function parseApplication(
  data: SubmitRoleApplicationRequest,
  userId: string,
  kycVerified: boolean,
  now: FirebaseFirestore.Timestamp
): { role: PrivilegedRole; application: RoleApplication; kyc: KycDocument | null } {
  const role = data?.requestedRole;
  if (!isPrivilegedRole(role)) {
    throw new https.HttpsError("invalid-argument", "requestedRole must be merchant, topup_agent or agent_merchant");
  }

  const application: RoleApplication = {
    businessName: text(data.businessName, "Business name"),
    // Asked short: only the name, the pin and the photo are required. The
    // rest comes from Google when they pick their shop there, or stays blank.
    businessType: optional(data.businessType, 60) || "Shop",
    businessAddress: optional(data.businessAddress, 200),
    area: optional(data.area, 80),
    location: pin(data.location),
    shopPhotoPath: photoPath(data.shopPhotoPath, userId, "Shop photo"),
    includesId: false,
    submittedAt: now,
  };

  if (isMerchantRole(role)) {
    const provider = data.payout?.provider;
    if (provider !== "zaad" && provider !== "edahab") {
      throw new https.HttpsError("invalid-argument", "Choose Zaad or eDahab for payouts");
    }
    application.payout = { provider, number: msisdn(data.payout?.number, "Payout number") };
  }

  if (isAgentRole(role)) {
    // Hours and services aren't asked at sign-up any more (it was too long):
    // an agent offers both until they change it, and adds hours in settings.
    const picked = Array.isArray(data.agent?.services)
      ? SERVICES.filter((s) => data.agent!.services!.includes(s))
      : [];
    const hours = typeof data.agent?.openHours === "string" ? sanitizeString(data.agent.openHours).slice(0, 80) : "";
    application.agent = {
      openHours: hours,
      services: picked.length > 0 ? picked : [...SERVICES],
      ...(data.agent?.zaadReceiveNumber
        ? { zaadReceiveNumber: msisdn(data.agent.zaadReceiveNumber, "Zaad receiving number") }
        : {}),
    };
  }

  let kyc: KycDocument | null = null;
  if (!kycVerified) {
    const id = data.id;
    if (!id || !ID_TYPES.includes(id.idType)) {
      throw new https.HttpsError("invalid-argument", "Add your ID: type, number and photos");
    }
    // The reviewer reads the number off the photo (and types it on approval).
    const idNumber = optional(id.idNumber, 40);
    const front = photoPath(id.frontPath, userId, "Front of ID");
    const back = id.backPath ? photoPath(id.backPath, userId, "Back of ID") : undefined;
    const selfie = photoPath(id.selfiePath, userId, "Selfie");
    kyc = {
      idType: id.idType,
      idNumber,
      // Paths, not download links: the console signs short-lived URLs from them.
      frontPhotoUrl: front,
      selfieUrl: selfie,
      frontPhotoPath: front,
      selfiePath: selfie,
      ...(back ? { backPhotoUrl: back, backPhotoPath: back } : {}),
      status: "submitted",
      userId,
      submittedAt: now,
      source: "role_application",
    };
    application.includesId = true;
  }

  return { role, application, kyc };
}

/**
 * Callable: submit (or resubmit after a rejection) a full application.
 * Puts it in the console's Role applications queue as ready to decide.
 */
export const submitRoleApplication = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<SubmitRoleApplicationRequest>
  ): Promise<ApiResponse<{ requestId: string; status: RoleRequest["status"] }>> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);

    return db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new https.HttpsError("failed-precondition", "Finish setting up your account first");
      }
      const user = userSnap.data()!;
      const now = admin.firestore.Timestamp.now();
      const { role, application, kyc } = parseApplication(request.data, userId, user.kycStatus === "verified", now);

      if (user.accountType === role) {
        throw new https.HttpsError("failed-precondition", "You already have this account type");
      }

      const requestId = roleRequestId(userId, role);
      const ref = db.collection(ROLE_REQUESTS_COLLECTION).doc(requestId);
      const existing = (await tx.get(ref)).data() as RoleRequest | undefined;
      if (existing?.status === "approved") {
        throw new https.HttpsError("failed-precondition", "This application was already approved");
      }

      tx.set(
        ref,
        {
          userId,
          requestedRole: role,
          status: "pending",
          createdAt: existing?.status === "pending" ? existing.createdAt ?? now : now,
          businessName: application.businessName,
          area: application.area,
          application,
          reviewedBy: admin.firestore.FieldValue.delete(),
          reviewedAt: admin.firestore.FieldValue.delete(),
          reason: admin.firestore.FieldValue.delete(),
        },
        { merge: true }
      );

      if (kyc) {
        tx.set(userRef.collection("kyc").doc("latest"), kyc);
      }

      // The Zaad account (payouts go only there). Saved here the first time,
      // as setZaadAccount would without a PIN; one already on file is only
      // changed from Settings, with the PIN.
      const zaadNumber =
        application.payout?.provider === "zaad" ? application.payout.number : application.agent?.zaadReceiveNumber;
      let zaad: ZaadAccount | null = null;
      if (zaadNumber && !(user as User).zaad) {
        const zaadName = normaliseZaadName(request.data?.zaadName);
        if (!zaadName) {
          throw new https.HttpsError("invalid-argument", "Enter the full name your Zaad account is registered to");
        }
        zaad = { msisdn: zaadNumber, name: zaadName, updatedAt: now };
      }

      // Mirrored for the app's live listener; clients cannot write these fields.
      tx.set(
        userRef,
        {
          roleRequestStatus: "pending",
          roleRequestedRole: role,
          roleRequestReason: admin.firestore.FieldValue.delete(),
          roleApplicationSubmittedAt: now,
          ...(kyc ? { kycStatus: "submitted" } : {}),
          ...(zaad ? { zaad } : {}),
          updatedAt: now,
        },
        { merge: true }
      );

      return { success: true, message: "Application sent for review", data: { requestId, status: "pending" as const } };
    });
  }
);

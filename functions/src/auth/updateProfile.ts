import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, sanitizeString, validateEmail } from "../utils/validation";
import {
  ApiResponse,
  UserAddress,
  NotificationPreferences,
  LinkedAccounts,
  PreferredLanguage,
} from "../types";

interface UpdateProfileRequest {
  fullName?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: "male" | "female" | "other";
  address?: UserAddress;
  preferredLanguage?: PreferredLanguage;
  notificationPreferences?: Partial<NotificationPreferences>;
  linkedAccounts?: Partial<LinkedAccounts>;
}

const VALID_LANGUAGES: PreferredLanguage[] = ["en", "so", "ar"];
const VALID_GENDERS = ["male", "female", "other"];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_REGEX = /^\+252[0-9]{9}$/;

export const updateProfile = https.onCall(
  async (
    request: https.CallableRequest<UpdateProfileRequest>
  ): Promise<ApiResponse> => {
    requireAuth(request);
    const userId = request.auth!.uid;
    const data = request.data;

    const updates: Record<string, any> = {};

    if (data.fullName !== undefined) {
      const name = sanitizeString(data.fullName);
      if (name.length < 2) {
        throw new https.HttpsError(
          "invalid-argument",
          "Full name must be at least 2 characters"
        );
      }
      updates.fullName = name;
    }

    if (data.email !== undefined) {
      if (data.email !== "" && !validateEmail(data.email)) {
        throw new https.HttpsError("invalid-argument", "Invalid email format");
      }
      updates.email = data.email || null;
    }

    if (data.dateOfBirth !== undefined) {
      if (data.dateOfBirth !== "" && !DATE_REGEX.test(data.dateOfBirth)) {
        throw new https.HttpsError(
          "invalid-argument",
          "Date of birth must be YYYY-MM-DD"
        );
      }
      updates.dateOfBirth = data.dateOfBirth || null;
    }

    if (data.gender !== undefined) {
      if (data.gender !== null && !VALID_GENDERS.includes(data.gender)) {
        throw new https.HttpsError("invalid-argument", "Invalid gender value");
      }
      updates.gender = data.gender || null;
    }

    if (data.address !== undefined) {
      updates.address = {
        city: sanitizeString(data.address?.city ?? ""),
        district: sanitizeString(data.address?.district ?? ""),
        country: sanitizeString(data.address?.country ?? "Somalia"),
      };
    }

    if (data.preferredLanguage !== undefined) {
      if (!VALID_LANGUAGES.includes(data.preferredLanguage)) {
        throw new https.HttpsError(
          "invalid-argument",
          "Language must be en, so, or ar"
        );
      }
      updates.preferredLanguage = data.preferredLanguage;
    }

    if (data.notificationPreferences !== undefined) {
      const prefs = data.notificationPreferences;
      const patch: Record<string, boolean> = {};
      if (typeof prefs.push === "boolean")
        patch["notificationPreferences.push"] = prefs.push;
      if (typeof prefs.transactionAlerts === "boolean")
        patch["notificationPreferences.transactionAlerts"] =
          prefs.transactionAlerts;
      if (typeof prefs.promotions === "boolean")
        patch["notificationPreferences.promotions"] = prefs.promotions;
      Object.assign(updates, patch);
    }

    if (data.linkedAccounts !== undefined) {
      const la = data.linkedAccounts;
      if (la.zaadPhone !== undefined) {
        if (la.zaadPhone && !PHONE_REGEX.test(la.zaadPhone)) {
          throw new https.HttpsError(
            "invalid-argument",
            "Zaad phone must be a valid +252 number"
          );
        }
        updates["linkedAccounts.zaadPhone"] = la.zaadPhone || null;
      }
      if (la.edahabPhone !== undefined) {
        if (la.edahabPhone && !PHONE_REGEX.test(la.edahabPhone)) {
          throw new https.HttpsError(
            "invalid-argument",
            "eDahab phone must be a valid +252 number"
          );
        }
        updates["linkedAccounts.edahabPhone"] = la.edahabPhone || null;
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new https.HttpsError("invalid-argument", "No fields to update");
    }

    updates.updatedAt = admin.firestore.Timestamp.now();

    try {
      await admin.firestore().collection("users").doc(userId).update(updates);
      return { success: true, message: "Profile updated" };
    } catch (error: any) {
      console.error("Error updating profile:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to update profile"
      );
    }
  }
);

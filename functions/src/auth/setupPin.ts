import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { hashPin } from "../utils/encryption";
import { validatePin, requireAuth } from "../utils/validation";
import { ApiResponse } from "../types";
import { prepareJournalEntry, userAccount, PLATFORM_PROMO } from "../ledger";
import { isPrivilegedRole } from "../utils/roles";
import { assertNameChangeAllowed } from "../utils/nameLock";
import { readAuth, writeAuth, isStoredPinHash } from "./pinStore";
import { recordReferral } from "../referral/referralBonus";
import { ensureRoleRequest } from "../merchants/requestRole";

interface SetupPinRequest {
  /** Required when the user does not yet have a PIN on their profile */
  pin?: string;
  fullName: string;
  /**
   * The role the applicant *wants*. Privileged values file a role request for
   * admin review; they never grant the role directly.
   */
  accountType?: "customer" | "merchant" | "topup_agent" | "agent_merchant";
  referralCode?: string;
}

interface SetupPinResponse {
  alreadyHasPin?: boolean;
  /** True when a privileged role was requested and awaits admin review. */
  roleRequestPending?: boolean;
  roleRequestId?: string;
}

/**
 * Callable function to set up user PIN and complete profile.
 *
 * If the user already has a PIN, `pin` may be omitted; `fullName` is still
 * required.
 *
 * `accountType` is a *request*, not an instruction: privileged roles are
 * granted only by an admin (ADMIN_CONSOLE_PLAN.md §4.1). Every account is
 * created as `customer`; asking for merchant/agent files a `roleRequests`
 * entry and the response carries `roleRequestPending` so the client can show
 * a review-pending state instead of appearing to succeed.
 */
export const setupPin = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<SetupPinRequest>):
  Promise<ApiResponse<SetupPinResponse>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const { pin, fullName, accountType, referralCode } = request.data;

    if (!fullName || fullName.trim().length < 2) {
      throw new https.HttpsError(
        "invalid-argument",
        "Full name is required and must be at least 2 characters"
      );
    }

    try {
      const db = admin.firestore();
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();
      const userData = userDoc.exists ? userDoc.data() : undefined;
      const hasExistingPin = isStoredPinHash((await readAuth(userId, undefined, userData)).pinHash);

      // Both branches below write fullName, so re-running setup must not be
      // a way round the business-name lock.
      assertNameChangeAllowed(userData, fullName);

      if (hasExistingPin) {
        await userRef.update({
          fullName: fullName.trim(),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        const pendingRole = isPrivilegedRole(accountType)
          ? await ensureRoleRequest(db, userId, accountType, {
              businessName: fullName.trim(),
            })
          : undefined;

        // A PIN was submitted but one already exists — we deliberately do NOT
        // overwrite it (PIN changes require the current PIN via changePin, or
        // a fresh OTP via resetPin). Tell the client so it never treats the
        // submitted PIN as stored.
        return {
          success: true,
          message: "Profile updated",
          data: {
            alreadyHasPin: true,
            ...(pendingRole
              ? {
                  roleRequestPending: pendingRole.status === "pending",
                  roleRequestId: pendingRole.requestId,
                }
              : {}),
          },
        };
      }

      if (!pin || !validatePin(pin)) {
        throw new https.HttpsError(
          "invalid-argument",
          "PIN must be exactly 6 digits"
        );
      }

      const pinHash = await hashPin(pin);

      // The hash goes to the server-only auth doc (pinStore.ts), never here.
      const authBatch = db.batch();
      writeAuth(authBatch, userId, { pinHash, pinFailedAttempts: 0, pinLockedUntil: null }, { hasPin: true });
      await authBatch.commit();

      await userRef.set(
        {
          fullName: fullName.trim(),
          phoneNumber: request.auth!.token.phone_number || "",
          updatedAt: admin.firestore.Timestamp.now(),
          ...(userDoc.exists
            ? {}
            : {
                // Only ever set at creation, and never the requested role:
                // privileged roles need admin approval. Setting it here
                // unconditionally would downgrade an already-approved
                // merchant who reaches this path without a stored PIN.
                accountType: "customer",
                kycStatus: "pending",
                preferredLanguage: "en",
                notificationPreferences: {
                  push: true,
                  transactionAlerts: true,
                  promotions: false,
                },
                linkedAccounts: {},
                dailyTransactionLimit: 50000,
                monthlyTransactionLimit: 500000,
                referralCode: crypto.randomBytes(4).toString("hex").toUpperCase(),
                createdAt: admin.firestore.Timestamp.now(),
                isActive: true,
              }),
        },
        { merge: true }
      );

      if (!userDoc.exists) {
        const walletRef = db.collection("wallets").doc(userId);
        const walletDoc = await walletRef.get();
        if (!walletDoc.exists) {
          await walletRef.set({
            balance: 0,
            currency: "USD",
            totalReceived: 0,
            totalSent: 0,
            lastTransactionAt: null,
            updatedAt: admin.firestore.Timestamp.now(),
          });
        }
      }

      const pendingRole = isPrivilegedRole(accountType)
        ? await ensureRoleRequest(db, userId, accountType, {
            businessName: fullName.trim(),
          })
        : undefined;

      // Records the inviter only; the bonus waits for the new user's first
      // qualifying action (referral/referralBonus.ts, decision D3).
      if (referralCode && typeof referralCode === "string" && !userDoc.exists) {
        await recordReferral(db, userId, referralCode.trim().toUpperCase()).catch((err) =>
          console.error("Recording referral failed (non-fatal):", err)
        );
      }

      return {
        success: true,
        message: "PIN set up successfully",
        data: pendingRole
          ? {
              roleRequestPending: pendingRole.status === "pending",
              roleRequestId: pendingRole.requestId,
            }
          : {},
      };
    } catch (error: any) {
      if (error instanceof https.HttpsError) throw error;
      console.error("Error setting up PIN:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to set up PIN"
      );
    }
  }
);

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { assertAccountActive, isAccountActive } from "../utils/accountStatus";
import { canLookupUsers } from "../utils/roles";
import { ApiResponse } from "../types";
import { spendLookup } from "./lookupRecipient";

interface LookupUserRequest {
  phoneNumber: string;
}

interface LookupUserResponse {
  userId: string;
  phoneNumber: string;
  fullName: string;
  accountType: string;
}

/**
 * Lookups one agent or shop may make. More than a customer gets
 * (lookupRecipient): a busy counter serves many people in an hour. Still far
 * too few to walk the phone book, which is what this answer, a full name and
 * an account for any number typed, would otherwise allow.
 */
export const AGENT_LOOKUP_LIMITS = { perHour: 60, perDay: 300 };

const PHONE_REGEX = /^\+[0-9]{8,15}$/;

const NOT_FOUND = "User not found with this phone number";

/**
 * Lookup user by phone number
 * Used by agents to find users for manual top-ups
 *
 * Closed and frozen accounts read as not found, so the answer doesn't give
 * away an account's status, and every call, found or not, is counted against
 * the caller's budget.
 */
export const lookupUserByPhone = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<LookupUserRequest>
  ): Promise<ApiResponse<LookupUserResponse>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;

    const phoneNumber = request.data?.phoneNumber;

    if (!phoneNumber) {
      throw new https.HttpsError(
        "invalid-argument",
        "Phone number is required"
      );
    }
    if (typeof phoneNumber !== "string" || !PHONE_REGEX.test(phoneNumber)) {
      throw new https.HttpsError(
        "invalid-argument",
        "A phone number like +252631234567 is required"
      );
    }

    try {
      const db = admin.firestore();

      // Verify agent is authorized
      const agentDoc = await db.collection("users").doc(agentId).get();
      if (!agentDoc.exists) {
        throw new https.HttpsError("not-found", "Agent not found");
      }

      const agentData = agentDoc.data();
      // Previously spelled out inline and missing `agent_merchant`, which
      // locked agent-merchants out of the first step of the top-up flow.
      if (!canLookupUsers(agentData?.accountType)) {
        throw new https.HttpsError(
          "permission-denied",
          "Not authorized to lookup users"
        );
      }
      // A frozen agent can't serve customers, so has nobody to look up.
      assertAccountActive(agentData);

      await spendLookup(agentId, Date.now(), AGENT_LOOKUP_LIMITS, "agent_");

      // Lookup user by phone number
      const usersSnapshot = await db
        .collection("users")
        .where("phoneNumber", "==", phoneNumber)
        .limit(1)
        .get();

      if (usersSnapshot.empty || !isAccountActive(usersSnapshot.docs[0].data())) {
        return {
          success: false,
          error: NOT_FOUND,
        };
      }

      const userDoc = usersSnapshot.docs[0];
      const userData = userDoc.data();

      return {
        success: true,
        data: {
          userId: userDoc.id,
          phoneNumber: userData.phoneNumber,
          fullName: userData.fullName || "Unknown",
          accountType: userData.accountType,
        },
      };
    } catch (error: any) {
      // Refusals keep their own code: wrapped as "internal" they told a
      // frozen or over-budget caller nothing they could act on.
      if (error instanceof https.HttpsError) throw error;
      console.error("Error looking up user:", error);
      throw new https.HttpsError("internal", "Failed to lookup user");
    }
  }
);

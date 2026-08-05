import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { canLookupUsers } from "../utils/roles";
import { ApiResponse } from "../types";

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
 * Lookup user by phone number
 * Used by agents to find users for manual top-ups
 */
export const lookupUserByPhone = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<LookupUserRequest>
  ): Promise<ApiResponse<LookupUserResponse>> => {
    requireAuth(request);
    const agentId = request.auth!.uid;

    const { phoneNumber } = request.data;

    if (!phoneNumber) {
      throw new https.HttpsError(
        "invalid-argument",
        "Phone number is required"
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

      // Lookup user by phone number
      const usersSnapshot = await db
        .collection("users")
        .where("phoneNumber", "==", phoneNumber)
        .limit(1)
        .get();

      if (usersSnapshot.empty) {
        return {
          success: false,
          error: "User not found with this phone number",
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
      console.error("Error looking up user:", error);
      throw new https.HttpsError(
        "internal",
        error.message || "Failed to lookup user"
      );
    }
  }
);

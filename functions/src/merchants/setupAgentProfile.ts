import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth, sanitizeString } from "../utils/validation";
import { ApiResponse, AgentInfo } from "../types";

interface SetupAgentProfileRequest {
  businessName?: string;
  area: string;
  openHours: string;
  services: ("cash_in" | "cash_out")[];
}

export const setupAgentProfile = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<SetupAgentProfileRequest>
  ): Promise<ApiResponse<AgentInfo>> => {
    requireAuth(request);
    const userId = request.auth!.uid;

    const { businessName, area, openHours, services } = request.data;

    if (!area || typeof area !== "string" || !area.trim()) {
      throw new https.HttpsError("invalid-argument", "Area is required");
    }
    if (!openHours || typeof openHours !== "string" || !openHours.trim()) {
      throw new https.HttpsError("invalid-argument", "Open hours are required");
    }
    if (!Array.isArray(services) || services.length === 0) {
      throw new https.HttpsError("invalid-argument", "At least one service is required");
    }

    const db = admin.firestore();
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      throw new https.HttpsError("not-found", "User not found");
    }

    const userData = userDoc.data();
    if (
      userData?.accountType !== "topup_agent" &&
      userData?.accountType !== "agent_merchant"
    ) {
      throw new https.HttpsError(
        "permission-denied",
        "Only agents can set up an agent profile"
      );
    }

    const agentInfo: AgentInfo = {
      area: sanitizeString(area),
      openHours: sanitizeString(openHours),
      services,
      isActive: true,
      ...(businessName?.trim() ? { businessName: sanitizeString(businessName) } : {}),
    };

    await db.collection("users").doc(userId).update({
      agentInfo,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    return {
      success: true,
      data: agentInfo,
      message: "Agent profile updated",
    };
  }
);

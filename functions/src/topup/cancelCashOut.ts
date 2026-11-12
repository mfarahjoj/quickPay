import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { ApiResponse, CashOutRequest } from "../types";
import { releaseCashOutHold } from "./cashOutHold";

/**
 * Customer cancels their own pending cash-out and gets the held money back.
 *
 * No PIN: this only ever returns money to the person who asked for the
 * cash-out. App Check and ownership still apply.
 */
export const cancelCashOut = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<{ cashOutId: string }>
  ): Promise<ApiResponse<{ returned: boolean }>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;
    const cashOutId = request.data?.cashOutId;
    if (typeof cashOutId !== "string" || !cashOutId || cashOutId.includes("/")) {
      throw new https.HttpsError("invalid-argument", "cashOutId is required");
    }

    const snap = await admin.firestore().collection("cashOutRequests").doc(cashOutId).get();
    const cashOut = snap.exists ? (snap.data() as CashOutRequest) : null;
    // Someone else's id reads as not found, never as "not yours".
    if (!cashOut || cashOut.customerId !== customerId) {
      throw new https.HttpsError("not-found", "Cash-out not found");
    }
    if (cashOut.status === "completed") {
      throw new https.HttpsError("failed-precondition", "An agent has already paid out this cash-out");
    }

    const returned = await releaseCashOutHold(cashOutId, "cancelled", customerId);
    return { success: true, data: { returned } };
  }
);

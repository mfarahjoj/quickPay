import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import { ApiResponse, AgentTopupRequest, AgentTopupStatus } from "../types";
import { storedCurrency } from "./agentCurrency";

interface CancelResponse {
  status: AgentTopupStatus;
  /** Set when the agent had already moved it to Zaad: cancel that one instead. */
  zaadRequestId?: string;
}

/**
 * Customer cancels their own cash top-up request ("Top up with an agent").
 *
 * Nothing has moved while the request is pending: no float is held when an
 * agent scans it, and the wallet is credited only when the agent confirms. So
 * cancelling is just closing the request, inside a transaction so it races
 * agentConfirmTopup cleanly: whichever commits first wins, and the confirm
 * re-reads the status and refuses anything but "pending".
 *
 * No PIN: no money leaves anyone. App Check and ownership still apply.
 * Cancelling an already-closed request answers with its status, so a retry
 * after a lost reply is harmless. A request the agent moved to Zaad answers
 * with the Zaad request, which has its own cancel (customerCancelZaadTopup).
 *
 * A cancelled request stays disputable ("I gave the agent cash"), as an
 * expired one is (disputes.ts).
 */
export const customerCancelAgentTopup = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ requestId: string }>): Promise<ApiResponse<CancelResponse>> => {
    requireAuth(request);
    const uid = request.auth!.uid;
    const requestId = request.data?.requestId;
    if (typeof requestId !== "string" || !requestId || requestId.includes("/")) {
      throw new https.HttpsError("invalid-argument", "requestId is required");
    }

    const db = admin.firestore();
    const ref = db.collection("agentTopupRequests").doc(requestId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const topup = snap.exists ? (snap.data() as AgentTopupRequest) : null;
      // Someone else's id reads as not found, never as "not yours".
      if (!topup || topup.customerId !== uid) {
        throw new https.HttpsError("not-found", "Top-up not found");
      }
      if (topup.status === "completed") {
        throw new https.HttpsError("failed-precondition", "The agent has already topped up your wallet.", {
          reason: "completed",
        });
      }
      if (topup.status === "moved_to_zaad") {
        return { status: topup.status, zaadRequestId: topup.zaadRequestId, cancelled: null };
      }
      if (topup.status !== "pending") {
        // Already cancelled or expired: nothing to do.
        return { status: topup.status, cancelled: null };
      }
      tx.update(ref, {
        status: "cancelled",
        cancelledBy: "customer",
        cancelledAt: admin.firestore.Timestamp.now(),
      });
      return { status: "cancelled" as const, cancelled: topup };
    });

    // An agent who scanned it may be about to take the cash: tell them.
    const scannedBy = result.cancelled?.scannedBy;
    if (result.cancelled && scannedBy && scannedBy !== uid) {
      const currency = storedCurrency(result.cancelled.currency);
      notifyUser(
        scannedBy,
        "topup_cancelled",
        {
          key: "topup.cancelled_by_customer",
          params: { amount: pushAmount(result.cancelled.amount, currency) },
        },
        { type: "topup_cancelled", requestId }
      ).catch((err) => console.error("Failed to notify agent of cancel:", err));
    }

    return {
      success: true,
      data: {
        status: result.status,
        ...(result.zaadRequestId ? { zaadRequestId: result.zaadRequestId } : {}),
      },
    };
  }
);

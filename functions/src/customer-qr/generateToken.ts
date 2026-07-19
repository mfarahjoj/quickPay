import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAuth } from "../utils/validation";
import { encrypt, generateSecureId } from "../utils/encryption";
import { ApiResponse, CustomerToken, User } from "../types";

const TOKEN_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface GenerateTokenResponse {
  tokenId: string;
  tokenData: string;
  expiresAt: string;
}

export const generateCustomerToken = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest
  ): Promise<ApiResponse<GenerateTokenResponse>> => {
    requireAuth(request);
    const customerId = request.auth!.uid;

    const db = admin.firestore();

    const userDoc = await db.collection("users").doc(customerId).get();
    if (!userDoc.exists) {
      throw new https.HttpsError("not-found", "User not found");
    }

    const user = userDoc.data() as User;
    if (user.accountType !== "customer") {
      throw new https.HttpsError(
        "permission-denied",
        "Only customers can generate tokens"
      );
    }

    // Expire any still-active tokens for this user
    const activeTokens = await db
      .collection("customerTokens")
      .where("customerId", "==", customerId)
      .where("status", "==", "active")
      .get();

    const batch = db.batch();
    activeTokens.docs.forEach((doc) => {
      batch.update(doc.ref, { status: "expired" });
    });

    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      now.toMillis() + TOKEN_TTL_MS
    );

    const tokenRef = db.collection("customerTokens").doc();
    const token: CustomerToken = {
      customerId,
      status: "active",
      expiresAt,
      createdAt: now,
    };

    batch.set(tokenRef, token);
    await batch.commit();

    const tokenPayload = JSON.stringify({
      id: tokenRef.id,
      customerId,
      expiresAt: expiresAt.toDate().toISOString(),
      nonce: generateSecureId(16),
    });

    const tokenData = encrypt(tokenPayload);

    return {
      success: true,
      data: {
        tokenId: tokenRef.id,
        tokenData,
        expiresAt: expiresAt.toDate().toISOString(),
      },
    };
  }
);

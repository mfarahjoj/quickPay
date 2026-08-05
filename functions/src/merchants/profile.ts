/**
 * Merchant profile creation, shared by the paths that can produce one.
 *
 * Extracted from setupPin so role approval and merchant registration create
 * profiles identically — previously only setupPin knew how.
 */

import * as admin from "firebase-admin";

/**
 * Create the merchant profile if absent, or refresh the business name.
 *
 * Safe to call repeatedly: an existing profile keeps its settlement settings.
 */
export async function ensureMerchantProfile(
  db: admin.firestore.Firestore,
  userId: string,
  businessName: string
): Promise<void> {
  const merchantProfileRef = db.collection("merchantProfiles").doc(userId);
  const existing = await merchantProfileRef.get();

  if (existing.exists) {
    await merchantProfileRef.set(
      { businessName: businessName.trim() },
      { merge: true }
    );
    return;
  }

  await merchantProfileRef.set({
    businessName: businessName.trim(),
    businessType: "",
    businessAddress: "",
    settlementPreference: "zaad",
    minimumSettlementAmount: 1000,
  });
}

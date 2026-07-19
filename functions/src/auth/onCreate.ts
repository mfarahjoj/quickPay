import * as admin from "firebase-admin";
import { auth } from "firebase-functions/v1";
import { User, Wallet } from "../types";

/**
 * Trigger function that runs when a new user is created
 * Creates user profile and initializes wallet
 */
export const onUserCreate = auth.user().onCreate(async (user) => {
  const uid = user.uid;
  const phoneNumber = user.phoneNumber;

  if (!phoneNumber) {
    console.error("User created without phone number:", uid);
    return;
  }

  const db = admin.firestore();
  const batch = db.batch();

  try {
    // Create user profile
    const userProfile: Partial<User> = {
      phoneNumber,
      fullName: "", // To be updated by user
      accountType: "customer", // Default to customer
      pinHash: "", // To be set during onboarding
      kycStatus: "pending",
      createdAt: admin.firestore.Timestamp.now(),
      isActive: true,
    };

    const userRef = db.collection("users").doc(uid);
    batch.set(userRef, userProfile);

    // Create wallet
    const wallet: Wallet = {
      balance: 0,
      currency: "USD",
      totalReceived: 0,
      totalSent: 0,
      lastTransactionAt: null,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    const walletRef = db.collection("wallets").doc(uid);
    batch.set(walletRef, wallet);

    // Commit batch
    await batch.commit();

    console.log(`Successfully created profile and wallet for user ${uid}`);
  } catch (error) {
    console.error("Error creating user profile and wallet:", error);
    throw error;
  }
});

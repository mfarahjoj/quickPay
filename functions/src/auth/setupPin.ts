import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import { hashPin } from "../utils/encryption";
import { validatePin, requireAuth, hasStoredPinHash } from "../utils/validation";
import { ApiResponse } from "../types";
import { prepareJournalEntry, userAccount, PLATFORM_PROMO } from "../ledger";

interface SetupPinRequest {
  /** Required when the user does not yet have a PIN on their profile */
  pin?: string;
  fullName: string;
  accountType?: "customer" | "merchant" | "topup_agent" | "agent_merchant";
  referralCode?: string;
}

async function creditReferralBonus(
  db: admin.firestore.Firestore,
  newUserId: string,
  referralCode: string,
  newUserFullName: string
): Promise<void> {
  const referrerQuery = await db
    .collection("users")
    .where("referralCode", "==", referralCode)
    .limit(1)
    .get();

  if (referrerQuery.empty) {
    console.log(`Referral code ${referralCode} not found — skipping bonus`);
    return;
  }

  const referrerId = referrerQuery.docs[0].id;
  if (referrerId === newUserId) {
    console.log("Self-referral detected — skipping bonus");
    return;
  }

  const newUserRef = db.collection("users").doc(newUserId);
  const referrerUserRef = db.collection("users").doc(referrerId);
  const BONUS_CENTS = 100;

  await db.runTransaction(async (tx) => {
    const newUserSnap = await tx.get(newUserRef);
    if (newUserSnap.data()?.referralBonusClaimedAt) {
      console.log(`Referral bonus already claimed for ${newUserId}`);
      return;
    }

    const referrerSnap = await tx.get(referrerUserRef);
    const referrerName: string = referrerSnap.data()?.fullName ?? "your friend";

    // Both bonuses are platform marketing spend, posted as one entry.
    // Entry ID derives from the new user: a signup bonus is claimable once.
    const pending = await prepareJournalEntry(tx, {
      entryId: `referral_${newUserId}`,
      type: "referral_bonus",
      currency: "USD",
      lines: [
        { account: PLATFORM_PROMO, debit: BONUS_CENTS * 2, credit: 0 },
        { account: userAccount(newUserId), debit: 0, credit: BONUS_CENTS },
        { account: userAccount(referrerId), debit: 0, credit: BONUS_CENTS },
      ],
      description: "Referral bonus",
      postedBy: "system",
    });

    const now = admin.firestore.Timestamp.now();

    pending.write(tx);

    tx.set(db.collection("transactions").doc(), {
      type: "referral",
      fromUserId: "system",
      toUserId: newUserId,
      participants: ["system", newUserId],
      amount: BONUS_CENTS,
      currency: "USD",
      status: "completed",
      description: `Referral bonus — invited by ${referrerName}`,
      journalEntryId: `referral_${newUserId}`,
      createdAt: now,
      completedAt: now,
    });

    tx.set(db.collection("transactions").doc(), {
      type: "referral",
      fromUserId: "system",
      toUserId: referrerId,
      participants: ["system", referrerId],
      amount: BONUS_CENTS,
      currency: "USD",
      status: "completed",
      description: `Referral bonus — you invited ${newUserFullName}`,
      journalEntryId: `referral_${newUserId}`,
      createdAt: now,
      completedAt: now,
    });

    tx.update(newUserRef, {
      referredBy: referrerId,
      referralBonusClaimedAt: now,
    });

    tx.update(referrerUserRef, {
      referralCount: admin.firestore.FieldValue.increment(1),
    });
  });

  console.log(`Referral bonus credited: referrer=${referrerId} newUser=${newUserId}`);
}

async function ensureMerchantProfile(
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

/**
 * Callable function to set up user PIN and complete profile.
 * If the user already has a PIN, `pin` may be omitted; `fullName` is still required,
 * and `accountType` may be set to `merchant` or `topup_agent` for merchant onboarding.
 */
export const setupPin = https.onCall(
  async (request: https.CallableRequest<SetupPinRequest>):
  Promise<ApiResponse<{ alreadyHasPin?: boolean }>> => {
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
      const hasExistingPin = hasStoredPinHash(userData?.pinHash);

      if (hasExistingPin) {
        const updates: Record<string, unknown> = {
          fullName: fullName.trim(),
          updatedAt: admin.firestore.Timestamp.now(),
        };
        if (accountType === "merchant" || accountType === "topup_agent" || accountType === "agent_merchant") {
          updates.accountType = accountType;
        }
        await userRef.update(updates);

        if (accountType === "merchant" || accountType === "topup_agent" || accountType === "agent_merchant") {
          await ensureMerchantProfile(db, userId, fullName.trim());
        }

        // A PIN was submitted but one already exists — we deliberately do NOT
        // overwrite it (PIN changes require the current PIN via changePin, or
        // a fresh OTP via resetPin). Tell the client so it never treats the
        // submitted PIN as stored.
        return {
          success: true,
          message: "Profile updated",
          data: { alreadyHasPin: true },
        };
      }

      if (!pin || !validatePin(pin)) {
        throw new https.HttpsError(
          "invalid-argument",
          "PIN must be exactly 6 digits"
        );
      }

      const pinHash = await hashPin(pin);
      const resolvedType = accountType || "customer";

      await userRef.set(
        {
          pinHash,
          fullName: fullName.trim(),
          accountType: resolvedType,
          phoneNumber: request.auth!.token.phone_number || "",
          updatedAt: admin.firestore.Timestamp.now(),
          ...(userDoc.exists
            ? {}
            : {
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

      if (resolvedType === "merchant" || resolvedType === "topup_agent" || resolvedType === "agent_merchant") {
        await ensureMerchantProfile(db, userId, fullName.trim());
      }

      if (referralCode && typeof referralCode === "string" && !userDoc.exists) {
        creditReferralBonus(db, userId, referralCode.trim().toUpperCase(), fullName.trim())
          .catch((err) => console.error("Referral bonus failed (non-fatal):", err));
      }

      return {
        success: true,
        message: "PIN set up successfully",
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

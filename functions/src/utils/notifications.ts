import * as admin from "firebase-admin";
import { Notification } from "../types";

/**
 * Send push notification to a user
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    // Get user's FCM tokens from Firestore
    const tokensSnapshot = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .collection("fcmTokens")
      .get();

    const tokens = tokensSnapshot.docs.map((doc) => doc.data().token);

    if (tokens.length === 0) {
      console.log(`No FCM tokens found for user ${userId}`);
      return;
    }

    // Send notification to all user devices
    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title,
        body,
      },
      data: data || {},
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "quickpay_notifications",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`Successfully sent ${response.successCount} notifications`);

    // Remove invalid tokens
    if (response.failureCount > 0) {
      const tokensToRemove: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          if (
            resp.error.code === "messaging/invalid-registration-token" ||
            resp.error.code === "messaging/registration-token-not-registered"
          ) {
            tokensToRemove.push(tokens[idx]);
          }
        }
      });

      // Remove invalid tokens from Firestore
      const batch = admin.firestore().batch();
      for (const token of tokensToRemove) {
        const tokenDocs = await admin
          .firestore()
          .collection("users")
          .doc(userId)
          .collection("fcmTokens")
          .where("token", "==", token)
          .get();

        tokenDocs.forEach((doc) => {
          batch.delete(doc.ref);
        });
      }
      await batch.commit();
    }
  } catch (error) {
    console.error("Error sending push notification:", error);
  }
}

/**
 * Store notification in Firestore
 */
export async function storeNotification(
  userId: string,
  type: Notification["type"],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  const notification: Notification = {
    userId,
    type,
    title,
    body,
    data,
    read: false,
    createdAt: admin.firestore.Timestamp.now(),
  };

  await admin.firestore().collection("notifications").add(notification);
}

/**
 * Send and store notification
 */
export async function notifyUser(
  userId: string,
  type: Notification["type"],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  await Promise.all([
    sendPushNotification(userId, title, body, data),
    storeNotification(userId, type, title, body, data),
  ]);
}

/**
 * Notify payment received
 */
export async function notifyPaymentReceived(
  merchantId: string,
  amount: number,
  currency: string,
  customerId: string
): Promise<void> {
  const amountFormatted = (amount / 100).toFixed(2);
  await notifyUser(
    merchantId,
    "payment_received",
    "Payment Received",
    `You received ${currency} ${amountFormatted}`,
    {
      type: "payment_received",
      amount: amount.toString(),
      currency,
      customerId,
    }
  );
}

/**
 * Notify payment sent
 */
export async function notifyPaymentSent(
  customerId: string,
  amount: number,
  currency: string,
  merchantId: string
): Promise<void> {
  const amountFormatted = (amount / 100).toFixed(2);
  await notifyUser(
    customerId,
    "payment_sent",
    "Payment Sent",
    `You paid ${currency} ${amountFormatted}`,
    {
      type: "payment_sent",
      amount: amount.toString(),
      currency,
      merchantId,
    }
  );
}

/**
 * Notify top-up completed
 */
export async function notifyTopupCompleted(
  userId: string,
  amount: number,
  currency: string,
  method: string
): Promise<void> {
  const amountFormatted = (amount / 100).toFixed(2);
  await notifyUser(
    userId,
    "topup_completed",
    "Top-up Successful",
    `Your wallet has been credited with ${currency} ${amountFormatted}`,
    {
      type: "topup_completed",
      amount: amount.toString(),
      currency,
      method,
    }
  );
}

/**
 * Notify settlement completed
 */
export async function notifySettlementCompleted(
  merchantId: string,
  amount: number,
  currency: string,
  method: string
): Promise<void> {
  const amountFormatted = (amount / 100).toFixed(2);
  await notifyUser(
    merchantId,
    "settlement_completed",
    "Settlement Completed",
    `${currency} ${amountFormatted} has been sent to your ${method} account`,
    {
      type: "settlement_completed",
      amount: amount.toString(),
      currency,
      method,
    }
  );
}

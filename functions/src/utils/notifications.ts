import * as admin from "firebase-admin";
import { Notification, PreferredLanguage } from "../types";
import { PushMessage, renderPush, resolveLanguage } from "./pushTemplates";

/**
 * The language a user reads their pushes in: `preferredLanguage`, which both
 * apps set from their language picker, else English.
 */
export async function pushLanguageOf(userId: string): Promise<PreferredLanguage> {
  try {
    const user = await admin.firestore().collection("users").doc(userId).get();
    return resolveLanguage(user.data()?.preferredLanguage);
  } catch (error) {
    console.error(`Couldn't read ${userId}'s language; sending English:`, error);
    return "en";
  }
}

/**
 * Send push notification to a user, in their own language. Push only: nothing
 * lands in their notifications list (see notifyUser for that).
 */
export async function sendPushNotification(
  userId: string,
  message: PushMessage,
  data?: Record<string, string>
): Promise<void> {
  const { title, body } = renderPush(message, await pushLanguageOf(userId));
  await deliverPush(userId, title, body, data);
}

/** Send already-written text to every device the user has. */
async function deliverPush(
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
 * Send and store notification, in the user's own language. The stored copy is
 * what the customer app's notifications list shows, so it matches the push.
 */
export async function notifyUser(
  userId: string,
  type: Notification["type"],
  message: PushMessage,
  data?: Record<string, string>
): Promise<void> {
  const { title, body } = renderPush(message, await pushLanguageOf(userId));
  await Promise.all([
    deliverPush(userId, title, body, data),
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
    { key: "payment.received", params: { amount: `${currency} ${amountFormatted}` } },
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
    { key: "payment.sent", params: { amount: `${currency} ${amountFormatted}` } },
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
    { key: "topup.completed", params: { amount: `${currency} ${amountFormatted}` } },
    {
      type: "topup_completed",
      amount: amount.toString(),
      currency,
      method,
    }
  );
}

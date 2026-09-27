import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { getRates } from "../config/rates";

/**
 * What kind of outgoing money a callable moves. Shop payments may use a small
 * allowance during the pause; everything else waits it out.
 */
export type OutgoingKind = "shop_payment" | "other";

/**
 * Refuse outgoing money for a while after a PIN reset.
 *
 * A reset proves only that someone holds the phone number. A thief holding
 * the phone, or someone who talked a telco into a SIM swap, can do that too,
 * so a fresh PIN must not be able to empty the wallet at once. Money coming
 * in is never affected. Shop payments may still spend a small total, so an
 * owner who really did forget their PIN can buy what they need.
 *
 * Call after the PIN check and before posting. The error carries
 * `reason: "pin_reset_cooldown"` and the end of the pause, for the app to
 * explain in the customer's language.
 */
export async function assertResetCooldownAllows(
  userId: string,
  kind: OutgoingKind,
  amountCents: number
): Promise<void> {
  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(userId).get();
  const resetAt = userSnap.data()?.pinResetAt as
    | admin.firestore.Timestamp
    | undefined;
  if (!resetAt) return;

  const { pinResetCooldownHours, pinResetCooldownAllowanceCents } = await getRates();
  const untilMs = resetAt.toMillis() + pinResetCooldownHours * 60 * 60 * 1000;
  if (Date.now() >= untilMs) return;

  const refuse = (): never => {
    throw new https.HttpsError(
      "failed-precondition",
      "Sending money is paused for a while after a PIN reset.",
      {
        reason: "pin_reset_cooldown",
        until: new Date(untilMs).toISOString(),
        allowanceCents: pinResetCooldownAllowanceCents,
      }
    );
  };

  if (kind !== "shop_payment") refuse();

  // Everything this account has sent since the reset counts against the
  // allowance, whichever screen it went through.
  const sent = await db
    .collection("transactions")
    .where("fromUserId", "==", userId)
    .where("createdAt", ">=", resetAt)
    .get();
  const spent = sent.docs.reduce(
    (sum, doc) => sum + ((doc.data().amount as number) ?? 0),
    0
  );
  if (spent + amountCents > pinResetCooldownAllowanceCents) refuse();
}

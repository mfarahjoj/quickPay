/**
 * Every display calls this once a minute, at start-up and after reconnecting.
 *
 * It is the heal path: whatever event a trigger missed, the state is
 * re-derived here, so a wrong screen lasts at most a minute. It also gives
 * the tablet the server's clock (cheap tablets keep bad time, and sale expiry
 * is judged on the tablet) and the build it should be running.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireDisplay } from "./guard";
import { syncCounterState } from "./state";
import { MERCHANT_DISPLAYS } from "./types";

const SEEN_WRITE_EVERY_MS = 50 * 1000;

function short(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  return v || null;
}

export const displayHeartbeat = https.onCall({ enforceAppCheck: true }, async (request) => {
  const caller = await requireDisplay(request);
  const { display, displayId, merchantId } = caller;
  const now = Date.now();
  const appBuild = short(request.data?.appBuild, 40);
  const lastError = short(request.data?.lastError, 200);

  const updates: Record<string, unknown> = {};
  const lastSeen = display.lastSeenAt?.toMillis?.() ?? 0;
  if (now - lastSeen >= SEEN_WRITE_EVERY_MS) updates.lastSeenAt = admin.firestore.Timestamp.fromMillis(now);
  if (appBuild && appBuild !== display.appBuild) updates.appBuild = appBuild;
  if (lastError) updates.lastError = lastError;
  if (Object.keys(updates).length > 0) {
    await admin.firestore().collection(MERCHANT_DISPLAYS).doc(displayId).update(updates);
  }

  await syncCounterState(merchantId, { onlyStateKey: display.stateKey ?? undefined });

  const appClient = (await admin.firestore().collection("config").doc("app_client").get()).data();
  const latestBuild = short(appClient?.display?.latestBuild, 40);

  return { success: true, data: { serverNowMs: Date.now(), latestBuild } };
});

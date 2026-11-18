/**
 * Zapp Business web sessions: list, sign out, and end them when it matters.
 *
 * Ending a session marks it inactive (the rules and requirePortalViewer stop
 * honouring it at once) and deletes its Firebase user, which kills its
 * refresh token, so the browser is signed out within the hour at most and
 * gets nothing in between.
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { https } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { isPortalToken, requireAuth } from "../utils/validation";
import { requirePortalViewer } from "./viewer";
import { MAX_ACTIVE_SESSIONS, PORTAL_SESSIONS, PortalSession, portalUid, SESSION_ID, SessionEndReason } from "./types";

type SessionDoc = { id: string; data: PortalSession };

async function activeSessions(merchantUid: string): Promise<SessionDoc[]> {
  const snap = await admin
    .firestore()
    .collection(PORTAL_SESSIONS)
    .where("merchantUid", "==", merchantUid)
    .where("active", "==", true)
    .get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as PortalSession }));
}

export async function endPortalSession(sessionId: string, reason: SessionEndReason): Promise<void> {
  await admin
    .firestore()
    .collection(PORTAL_SESSIONS)
    .doc(sessionId)
    .update({ active: false, endedAt: Timestamp.now(), endReason: reason });
  try {
    await admin.auth().deleteUser(portalUid(sessionId));
  } catch (err: any) {
    // Never signed in (the token wasn't collected), or already gone.
    if (err?.code !== "auth/user-not-found") console.error(`Could not delete ${portalUid(sessionId)}:`, err);
  }
}

/**
 * Sign every computer out of a shop's account: a PIN change or reset, a
 * device revoke, a freeze or a deletion (auth/sessions.ts endSessions).
 */
export async function endAllPortalSessions(merchantUid: string, reason: SessionEndReason = "security"): Promise<number> {
  const sessions = await activeSessions(merchantUid);
  for (const s of sessions) await endPortalSession(s.id, reason);
  return sessions.length;
}

/** Keep at most MAX_ACTIVE_SESSIONS per shop, signing out the oldest. */
export async function enforceSessionLimit(merchantUid: string): Promise<void> {
  const sessions = (await activeSessions(merchantUid)).sort(
    (a, b) => a.data.createdAt.toMillis() - b.data.createdAt.toMillis()
  );
  const extra = sessions.length - MAX_ACTIVE_SESSIONS;
  for (const s of sessions.slice(0, Math.max(0, extra))) await endPortalSession(s.id, "replaced");
}

export interface SessionSummary {
  sessionId: string;
  browser: string;
  createdAtMs: number;
  expiresAtMs: number;
  lastSeenAtMs: number | null;
}

/** The phone's Settings → Zapp Business: computers signed in now. */
export const listPortalSessions = https.onCall({ enforceAppCheck: true }, async (request) => {
  requireAuth(request);
  const now = Date.now();
  const sessions: SessionSummary[] = (await activeSessions(request.auth!.uid))
    .filter((s) => s.data.expiresAt.toMillis() > now)
    .sort((a, b) => b.data.createdAt.toMillis() - a.data.createdAt.toMillis())
    .map((s) => ({
      sessionId: s.id,
      browser: s.data.browser,
      createdAtMs: s.data.createdAt.toMillis(),
      expiresAtMs: s.data.expiresAt.toMillis(),
      lastSeenAtMs: s.data.lastSeenAt?.toMillis() ?? null,
    }));
  return { success: true, data: { sessions } };
});

/**
 * Sign a computer out. From the phone: any of the shop's sessions. From the
 * web: only its own ("Sign out").
 */
export const revokePortalSession = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ sessionId?: unknown }>) => {
    if (request.auth && isPortalToken(request.auth.token)) {
      const viewer = await requirePortalViewer(request);
      await endPortalSession(viewer.sessionId, "signed_out");
      return { success: true, data: { ended: 1 } };
    }
    requireAuth(request);
    const sessionId = request.data?.sessionId;
    if (sessionId === "all") {
      return { success: true, data: { ended: await endAllPortalSessions(request.auth!.uid, "revoked") } };
    }
    if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
      throw new https.HttpsError("invalid-argument", "sessionId is required");
    }
    const snap = await admin.firestore().collection(PORTAL_SESSIONS).doc(sessionId).get();
    const session = snap.data() as PortalSession | undefined;
    if (!snap.exists || session?.merchantUid !== request.auth!.uid) {
      throw new https.HttpsError("not-found", "That computer isn't signed in.", { reason: "portal_session_not_found" });
    }
    if (session.active) await endPortalSession(sessionId, "revoked");
    return { success: true, data: { ended: session.active ? 1 : 0 } };
  }
);

/** End sessions past their time, so their Firebase users don't pile up. */
export async function expirePortalSessionsNow(nowMs = Date.now()): Promise<number> {
  const snap = await admin
    .firestore()
    .collection(PORTAL_SESSIONS)
    .where("active", "==", true)
    .where("expiresAt", "<=", Timestamp.fromMillis(nowMs))
    .limit(500)
    .get();
  for (const doc of snap.docs) await endPortalSession(doc.id, "expired");
  return snap.size;
}

export const expirePortalSessions = onSchedule(
  { schedule: "every 1 hours", timeZone: "Africa/Mogadishu" },
  async () => {
    const ended = await expirePortalSessionsNow();
    if (ended) console.log(`Ended ${ended} expired Zapp Business session(s)`);
  }
);

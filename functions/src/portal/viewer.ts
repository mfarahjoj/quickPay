/**
 * The check every Zapp Business (portal) callable runs first.
 *
 * A portal session is its own Firebase user, `portal_{sessionId}`, with the
 * claims `{portal: true, portalFor: <shop uid>, portalSid}`. requireAuth and
 * requireAdmin refuse it, so it reaches nothing but the callables that call
 * this. Here it must also still be live: active, not expired, and the token's
 * shop must match the session's.
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { https } from "firebase-functions/v2";
import { isPortalToken } from "../utils/validation";
import { requireStaffGrant } from "../staff/access";
import { linkedStoreUids } from "./groups";
import { PORTAL_SESSIONS, PortalSession, portalUid, SESSION_ID } from "./types";

/** Write lastSeenAt at most this often, so a busy dashboard isn't a write per call. */
const SEEN_EVERY_MS = 5 * 60 * 1000;

export interface PortalViewer {
  sessionId: string;
  /** The shop that signed this computer in. */
  merchantUid: string;
  /** Shops this session may view: its own, then the stores it has linked. */
  storeUids: string[];
  session: PortalSession;
  /** "owner" for the shop's own sign-in; "manager" for a staff member's. */
  role: "owner" | "manager";
  /** The shop always; a staff manager only if the shop allowed it. */
  canSeeCustomers: boolean;
}

export function customersDenied(): https.HttpsError {
  return new https.HttpsError("permission-denied", "The shop hasn't given you access to customer details.", {
    reason: "portal_customers_denied",
  });
}

export function sessionEnded(): https.HttpsError {
  return new https.HttpsError("unauthenticated", "This sign-in has ended. Scan the code again with your phone.", {
    reason: "portal_session_ended",
  });
}

export async function requirePortalViewer(request: https.CallableRequest, storeUid?: unknown): Promise<PortalViewer> {
  const auth = request.auth;
  if (!auth || !isPortalToken(auth.token)) {
    throw new https.HttpsError("unauthenticated", "Sign in to Zapp Business first.", { reason: "portal_signin_required" });
  }
  const token = auth.token as Record<string, unknown>;
  const sessionId = token.portalSid;
  const merchantUid = token.portalFor;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId) || typeof merchantUid !== "string" || auth.uid !== portalUid(sessionId)) {
    throw sessionEnded();
  }

  const ref = admin.firestore().collection(PORTAL_SESSIONS).doc(sessionId);
  const snap = await ref.get();
  const session = snap.data() as PortalSession | undefined;
  const now = Date.now();
  if (!snap.exists || !session || !session.active || session.merchantUid !== merchantUid || session.expiresAt.toMillis() <= now) {
    throw sessionEnded();
  }

  // A staff member's sign-in holds only while their grant does (STAFF_ACCESS.md),
  // and covers only the shop that granted it: never the owner's linked stores.
  const staff = typeof session.actorUid === "string";
  let canSeeCustomers = true;
  if (staff) {
    try {
      const grant = await requireStaffGrant(merchantUid, session.actorUid!, "portal");
      canSeeCustomers = grant.showCustomers === true && session.showCustomers === true;
    } catch {
      throw sessionEnded();
    }
  }

  // Its own shop, and the stores it has linked (portal/groups.ts).
  const storeUids = staff ? [merchantUid] : [merchantUid, ...(await linkedStoreUids(merchantUid))];
  if (storeUid !== undefined && (typeof storeUid !== "string" || !storeUids.includes(storeUid))) {
    throw new https.HttpsError("permission-denied", "This sign-in can't view that shop.", { reason: "portal_store_denied" });
  }

  if (now - (session.lastSeenAt?.toMillis() ?? 0) >= SEEN_EVERY_MS) {
    ref.update({ lastSeenAt: Timestamp.fromMillis(now) }).catch(() => undefined);
  }
  return { sessionId, merchantUid, storeUids, session, role: staff ? "manager" : "owner", canSeeCustomers };
}

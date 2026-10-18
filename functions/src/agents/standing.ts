/**
 * Agent standing (plan item 2.6).
 *
 * Customers can only judge an agent by what happens at the counter, so the
 * locator shouldn't keep sending them to an agent who keeps losing disputes.
 * After every upheld dispute against an agent, their upheld claims over the
 * last `agentFlagWindowDays` are counted; at `agentFlagUpheldDisputes` the
 * agent is flagged, drops out of the locator, and ops are expected to look.
 * Flagging is a lead, not a sanction: the agent can still trade, and ops
 * clear the flag (adminClearAgentFlag) once satisfied.
 *
 * `listAgents` replaces the customer app reading other users' `users` docs
 * directly, which the rules have never allowed (owner-only reads).
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse } from "../types";
import { requireAuth } from "../utils/validation";
import { isAgentRole } from "../utils/roles";
import { isAccountActive } from "../utils/accountStatus";
import { getRates } from "../config/rates";
import { notifyUser } from "../utils/notifications";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "../admin/guard";
import { stageAuditEntry } from "../admin/audit";
import { DISPUTES_COLLECTION, DisputeDoc } from "../disputes/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AgentFlag {
  flaggedAt: FirebaseFirestore.Timestamp;
  upheldCount: number;
  windowDays: number;
}

/** Upheld disputes against this uid decided within the window. */
export async function countUpheldAgainst(uid: string, windowDays: number, nowMs = Date.now()): Promise<number> {
  const snap = await admin
    .firestore()
    .collection(DISPUTES_COLLECTION)
    .where("against", "==", uid)
    .limit(500)
    .get();
  const since = nowMs - windowDays * DAY_MS;
  return snap.docs.filter((d) => {
    const r = (d.data() as DisputeDoc).resolution;
    return r?.outcome === "upheld" && (r.decidedAt?.toMillis?.() ?? 0) >= since;
  }).length;
}

/**
 * Re-count an agent's upheld disputes and flag them at the threshold.
 * Safe to call for anyone: non-agents and already-flagged agents are left
 * alone. Never throws into the caller — standing is bookkeeping, not money.
 */
export async function reviewAgentStanding(uid: string | null | undefined): Promise<boolean> {
  if (!uid) return false;
  try {
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const user = (await userRef.get()).data();
    if (!user || !isAgentRole(user.accountType) || user.agentFlag) return false;

    const { agentFlagUpheldDisputes, agentFlagWindowDays } = await getRates();
    const upheldCount = await countUpheldAgainst(uid, agentFlagWindowDays);
    if (upheldCount < agentFlagUpheldDisputes) return false;

    const flag: AgentFlag = {
      flaggedAt: admin.firestore.Timestamp.now(),
      upheldCount,
      windowDays: agentFlagWindowDays,
    };
    await userRef.update({ agentFlag: flag });
    console.warn(`Agent ${uid} flagged: ${upheldCount} upheld disputes in ${agentFlagWindowDays} days`);
    notifyUser(
      uid,
      "agent_flagged",
      "Your agent listing is paused",
      "Several disputes against you were upheld recently, so customers won't see you in Find Agent until Zapp Pay has reviewed them.",
      { type: "agent_flagged" }
    ).catch((err) => console.error("Failed to notify agent flag:", err));
    return true;
  } catch (err) {
    console.error(`reviewAgentStanding(${uid}) failed:`, err);
    return false;
  }
}

export interface ListedAgent {
  id: string;
  name: string;
  phoneNumber: string | null;
  agentInfo: {
    area: string;
    openHours: string;
    services: ("cash_in" | "cash_out")[];
    businessName?: string;
  };
}

/** Agents a customer may be sent to: active, listed, not flagged. */
export const listAgents = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<void>): Promise<ApiResponse<{ agents: ListedAgent[] }>> => {
    requireAuth(request);
    const snap = await admin
      .firestore()
      .collection("users")
      .where("accountType", "in", ["topup_agent", "agent_merchant"])
      .limit(500)
      .get();

    const agents: ListedAgent[] = snap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(({ data }) => isAccountActive(data) && data.agentInfo && data.agentInfo.isActive !== false && !data.agentFlag)
      .map(({ id, data }) => ({
        id,
        name: data.agentInfo.businessName || data.fullName || "Zapp Pay agent",
        phoneNumber: data.phoneNumber ?? null,
        agentInfo: {
          area: data.agentInfo.area,
          openHours: data.agentInfo.openHours,
          services: data.agentInfo.services ?? [],
          ...(data.agentInfo.businessName ? { businessName: data.agentInfo.businessName } : {}),
        },
      }))
      .sort((a, b) => (a.agentInfo.area || "").localeCompare(b.agentInfo.area || ""));

    return { success: true, data: { agents } };
  }
);

/** Ops reviewed a flagged agent and are satisfied: list them again. */
export const adminClearAgentFlag = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ userId: string; reason: string }>): Promise<ApiResponse> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const userId = request.data?.userId;
    if (typeof userId !== "string" || !userId) {
      throw new https.HttpsError("invalid-argument", "userId is required");
    }
    const db = admin.firestore();
    const ref = db.collection("users").doc(userId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const flag = snap.data()?.agentFlag as AgentFlag | undefined;
      if (!flag) throw new https.HttpsError("failed-precondition", "This agent isn't flagged");
      tx.update(ref, { agentFlag: admin.firestore.FieldValue.delete() });
      stageAuditEntry(tx, {
        actor,
        action: "agent.unflag",
        target: { type: "user", id: userId },
        reason,
        before: { upheldCount: flag.upheldCount, flaggedAt: flag.flaggedAt.toMillis() },
      });
    });
    return { success: true, message: "Agent listed again" };
  }
);

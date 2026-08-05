/**
 * Float desk — issuing and withdrawing agent float.
 *
 * This replaces `scripts/seed-agent-float.js`, which posted real journal
 * entries using whoever ran it and their personal Firebase CLI credentials:
 * no record of who issued float, no second pair of eyes, no receipt for the
 * agent, and it always booked the value to `float:agents` no matter how the
 * agent actually paid.
 *
 * Here, requesting and approving are separate calls. Above the configured
 * threshold the approver must be a different admin, so no one person can move
 * value into an agent wallet alone.
 *
 * Journal templates (LEDGER_ARCHITECTURE.md §3.4):
 *   issue    — debit float:{route}, credit user:{agent}
 *   withdraw — debit user:{agent}, credit float:{route}
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import {
  ApiResponse,
  FloatDirection,
  FloatIssuance,
  FloatIssuanceStatus,
  Transaction,
} from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { getRates } from "../config/rates";
import { isAgentRole } from "../utils/roles";
import { resolveAccountStatus } from "../utils/accountStatus";
import { notifyUser } from "../utils/notifications";
import {
  prepareJournalEntry,
  userAccount,
  floatAccountForRoute,
  isFloatRoute,
  type FloatRoute,
} from "../ledger";

export const FLOAT_ISSUANCES_COLLECTION = "floatIssuances";

/** Routes where a bare "trust me" is not good enough. */
const REFERENCE_REQUIRED: FloatRoute[] = ["zaad", "edahab", "bank"];

/** Ceiling on a single movement — a typo should not become a $1M entry. */
const MAX_AMOUNT_CENTS = 100_000_00;

interface RequestFloatRequest {
  agentId: string;
  direction: FloatDirection;
  amountCents: number;
  route: FloatRoute;
  externalReference?: string;
  reason: string;
}

/**
 * Raise a float request. Posts nothing — approval does that.
 */
export const adminRequestFloat = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<RequestFloatRequest>
  ): Promise<
    ApiResponse<{ issuanceId: string; requiresSecondApprover: boolean }>
  > => {
    const actor = requireAdmin(request, "ops");
    requireRecentAdminAuth(request);

    const { agentId, direction, amountCents, route, externalReference } =
      request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof agentId !== "string" || !agentId.trim()) {
      throw new https.HttpsError("invalid-argument", "agentId is required");
    }
    if (direction !== "issue" && direction !== "withdraw") {
      throw new https.HttpsError(
        "invalid-argument",
        "direction must be 'issue' or 'withdraw'"
      );
    }
    if (
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      throw new https.HttpsError(
        "invalid-argument",
        "amountCents must be a positive integer"
      );
    }
    if (amountCents > MAX_AMOUNT_CENTS) {
      throw new https.HttpsError(
        "invalid-argument",
        `Single movement is capped at $${MAX_AMOUNT_CENTS / 100}`
      );
    }
    if (!isFloatRoute(route)) {
      throw new https.HttpsError(
        "invalid-argument",
        "route must be cash, zaad, edahab or bank"
      );
    }

    const reference = typeof externalReference === "string" ? externalReference.trim() : "";
    if (REFERENCE_REQUIRED.includes(route) && reference.length < 3) {
      throw new https.HttpsError(
        "invalid-argument",
        `A ${route} movement needs its external reference (transaction id or slip number) for reconciliation`
      );
    }

    const db = admin.firestore();
    const agentSnap = await db.collection("users").doc(agentId).get();
    if (!agentSnap.exists) {
      throw new https.HttpsError("not-found", "Agent not found");
    }

    const agentData = agentSnap.data()!;
    if (!isAgentRole(agentData.accountType)) {
      throw new https.HttpsError(
        "failed-precondition",
        "Float can only be issued to a topup_agent or agent_merchant"
      );
    }
    if (resolveAccountStatus(agentData) !== "active") {
      throw new https.HttpsError(
        "failed-precondition",
        "This agent's account is not active"
      );
    }

    const { floatApprovalThresholdCents } = await getRates();
    const requiresSecondApprover = amountCents >= floatApprovalThresholdCents;

    const ref = db.collection(FLOAT_ISSUANCES_COLLECTION).doc();
    const issuance: FloatIssuance = {
      agentId,
      agentName: agentData.fullName,
      direction,
      amountCents,
      route,
      status: "pending",
      requestedBy: actor.uid,
      requestedByEmail: actor.email,
      requestReason: reason,
      requiresSecondApprover,
      createdAt: admin.firestore.Timestamp.now(),
      ...(reference ? { externalReference: reference } : {}),
    };

    await db.runTransaction(async (tx) => {
      tx.create(ref, issuance);
      stageAuditEntry(tx, {
        actor,
        action: "float.request",
        target: { type: "float_issuance", id: ref.id },
        reason,
        after: { agentId, direction, amountCents, route, requiresSecondApprover },
      });
    });

    return {
      success: true,
      message: requiresSecondApprover
        ? "Requested — needs a second admin to approve"
        : "Requested — ready to approve",
      data: { issuanceId: ref.id, requiresSecondApprover },
    };
  }
);

interface DecideFloatRequest {
  issuanceId: string;
  reason: string;
}

/**
 * Approve a pending request and post it to the ledger.
 *
 * Everything — the journal entry, the projections, the issuance status, the
 * transaction row and the audit entry — happens in one Firestore transaction,
 * so there is no state where value moved but the record says otherwise.
 */
export const adminApproveFloat = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<DecideFloatRequest>
  ): Promise<
    ApiResponse<{ issuanceId: string; journalEntryId: string; transactionId: string }>
  > => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);

    const { issuanceId } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof issuanceId !== "string" || !issuanceId.trim()) {
      throw new https.HttpsError("invalid-argument", "issuanceId is required");
    }

    const db = admin.firestore();
    const issuanceRef = db.collection(FLOAT_ISSUANCES_COLLECTION).doc(issuanceId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(issuanceRef);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "Float request not found");
      }

      const issuance = snap.data() as FloatIssuance;

      if (issuance.status !== "pending") {
        throw new https.HttpsError(
          "failed-precondition",
          `This request was already ${issuance.status}`
        );
      }

      // Maker-checker. The flag was fixed when the request was raised, so
      // lowering the threshold afterwards cannot retroactively wave one through.
      if (issuance.requiresSecondApprover && issuance.requestedBy === actor.uid) {
        throw new https.HttpsError(
          "permission-denied",
          "This amount needs a second admin to approve it"
        );
      }

      const entryPrefix =
        issuance.direction === "issue" ? "float_issue" : "float_withdraw";
      const journalEntryId = `${entryPrefix}_${issuanceId}`;
      const transactionId = journalEntryId;
      const floatAccount = floatAccountForRoute(issuance.route as FloatRoute);
      const agentLedgerAccount = userAccount(issuance.agentId);

      const lines =
        issuance.direction === "issue"
          ? [
              { account: floatAccount, debit: issuance.amountCents, credit: 0 },
              { account: agentLedgerAccount, debit: 0, credit: issuance.amountCents },
            ]
          : [
              { account: agentLedgerAccount, debit: issuance.amountCents, credit: 0 },
              { account: floatAccount, debit: 0, credit: issuance.amountCents },
            ];

      const prepared = await prepareJournalEntry(tx, {
        entryId: journalEntryId,
        type: issuance.direction === "issue" ? "float_issue" : "float_withdraw",
        currency: "USD",
        lines,
        refs: { transactionId },
        description:
          issuance.direction === "issue"
            ? `Float issued via ${issuance.route}`
            : `Float withdrawn via ${issuance.route}`,
        postedBy: actor.uid,
      });

      // A retry that lost its response would otherwise re-approve; the entry
      // already exists, so treat it as done rather than posting twice.
      if (!prepared.alreadyPosted) {
        prepared.write(tx);
      }

      const now = admin.firestore.Timestamp.now();

      const txRecord: Transaction = {
        type: issuance.direction === "issue" ? "topup" : "withdrawal",
        fromUserId: issuance.direction === "issue" ? "system" : issuance.agentId,
        toUserId: issuance.direction === "issue" ? issuance.agentId : "system",
        participants: [issuance.agentId],
        amount: issuance.amountCents,
        currency: "USD",
        status: "completed",
        description:
          issuance.direction === "issue"
            ? `Float purchase (${issuance.route})`
            : `Float withdrawal (${issuance.route})`,
        ...(issuance.externalReference ? { reference: issuance.externalReference } : {}),
        journalEntryId,
        createdAt: now,
        completedAt: now,
      };
      tx.set(db.collection("transactions").doc(transactionId), txRecord);

      tx.update(issuanceRef, {
        status: "approved" as FloatIssuanceStatus,
        decidedBy: actor.uid,
        decidedAt: now,
        decisionReason: reason,
        journalEntryId,
        transactionId,
      });

      const auditId = stageAuditEntry(tx, {
        actor,
        action: "float.approve",
        target: { type: "float_issuance", id: issuanceId },
        reason,
        before: { status: "pending" },
        after: {
          status: "approved",
          agentId: issuance.agentId,
          direction: issuance.direction,
          amountCents: issuance.amountCents,
          route: issuance.route,
        },
        journalEntryId,
      });

      return {
        auditId,
        journalEntryId,
        transactionId,
        agentId: issuance.agentId,
        direction: issuance.direction,
        amountCents: issuance.amountCents,
      };
    });

    notifyUser(
      result.agentId,
      result.direction === "issue" ? "float_issued" : "float_withdrawn",
      result.direction === "issue" ? "Float added" : "Float withdrawn",
      `${result.direction === "issue" ? "+" : "-"}$${(result.amountCents / 100).toFixed(
        2
      )} float`,
      { transactionId: result.transactionId }
    ).catch((err) => console.error("Failed to notify agent:", err));

    console.log(
      `Float ${result.direction} ${result.amountCents}c for ${result.agentId} approved by ${actor.uid}`
    );

    return {
      success: true,
      message: "Approved and posted",
      data: {
        issuanceId,
        journalEntryId: result.journalEntryId,
        transactionId: result.transactionId,
      },
    };
  }
);

/** Reject a pending request. Nothing is posted. */
export const adminRejectFloat = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<DecideFloatRequest>
  ): Promise<ApiResponse<{ issuanceId: string }>> => {
    const actor = requireAdmin(request, ["ops", "super"]);
    requireRecentAdminAuth(request);

    const { issuanceId } = request.data ?? {};
    const reason = requireReason(request.data?.reason);

    if (typeof issuanceId !== "string" || !issuanceId.trim()) {
      throw new https.HttpsError("invalid-argument", "issuanceId is required");
    }

    const db = admin.firestore();
    const issuanceRef = db.collection(FLOAT_ISSUANCES_COLLECTION).doc(issuanceId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(issuanceRef);
      if (!snap.exists) {
        throw new https.HttpsError("not-found", "Float request not found");
      }
      const issuance = snap.data() as FloatIssuance;
      if (issuance.status !== "pending") {
        throw new https.HttpsError(
          "failed-precondition",
          `This request was already ${issuance.status}`
        );
      }

      tx.update(issuanceRef, {
        status: "rejected" as FloatIssuanceStatus,
        decidedBy: actor.uid,
        decidedAt: admin.firestore.Timestamp.now(),
        decisionReason: reason,
      });

      stageAuditEntry(tx, {
        actor,
        action: "float.reject",
        target: { type: "float_issuance", id: issuanceId },
        reason,
        before: { status: "pending" },
        after: { status: "rejected" },
      });
    });

    return { success: true, message: "Rejected", data: { issuanceId } };
  }
);

interface ListFloatRequest {
  status?: FloatIssuanceStatus;
  limit?: number;
}

/** Callable: the float request queue / history. */
export const adminListFloatIssuances = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<ListFloatRequest>
  ): Promise<ApiResponse<Array<FloatIssuance & { issuanceId: string }>>> => {
    requireAdmin(request, ["ops", "super"]);

    const status = request.data?.status ?? "pending";
    const limit = Math.min(Math.max(request.data?.limit ?? 50, 1), 200);

    const snap = await admin
      .firestore()
      .collection(FLOAT_ISSUANCES_COLLECTION)
      .where("status", "==", status)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return {
      success: true,
      data: snap.docs.map((d) => ({
        issuanceId: d.id,
        ...(d.data() as FloatIssuance),
      })),
    };
  }
);

interface AgentPosition {
  agentId: string;
  fullName?: string;
  phoneNumber?: string;
  accountType?: string;
  accountStatus: string;
  balanceCents: number;
}

/**
 * Every agent's current float, lowest first.
 *
 * An agent at zero cannot serve customers, so this is the working view for
 * whoever runs the desk.
 */
export const adminListAgentFloat = https.onCall(
  { enforceAppCheck: true },
  async (
    request: https.CallableRequest<void>
  ): Promise<ApiResponse<AgentPosition[]>> => {
    requireAdmin(request, ["ops", "super"]);

    const db = admin.firestore();
    const agentsSnap = await db
      .collection("users")
      .where("accountType", "in", ["topup_agent", "agent_merchant"])
      .limit(300)
      .get();

    if (agentsSnap.empty) return { success: true, data: [] };

    const wallets = await db.getAll(
      ...agentsSnap.docs.map((d) => db.collection("wallets").doc(d.id))
    );
    const balanceById = new Map(
      wallets.map((w) => [w.id, (w.data()?.balance as number) ?? 0])
    );

    const positions: AgentPosition[] = agentsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        agentId: doc.id,
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        accountType: data.accountType,
        accountStatus: resolveAccountStatus(data),
        balanceCents: balanceById.get(doc.id) ?? 0,
      };
    });

    positions.sort((a, b) => a.balanceCents - b.balanceCents);

    return { success: true, data: positions };
  }
);

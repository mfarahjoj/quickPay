/**
 * Ops' side of Zaad top-ups through agents: set up an agent after checking
 * their Zaad number in person (D4), decide disputes, confirm reversals
 * (D16), clear a blocked customer, and list what needs looking at.
 *
 * Every call needs a recent admin sign-in and a reason, and writes an audit
 * entry in the same transaction as its effect.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "../admin/guard";
import { stageAuditEntry } from "../admin/audit";
import { getRates } from "../config/rates";
import { prepareJournalEntry, walletPocket, LEDGER_BALANCES_COLLECTION, ZAAD_AGENT_HOLD, ZAAD_REVERSAL_LOSSES } from "../ledger";
import { isAgentRole } from "../utils/roles";
import { normaliseSomaliMsisdn } from "../utils/msisdn";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";
import { reviewAgentStanding } from "../agents/standing";
import { ApiResponse, Wallet } from "../types";
import { HEARTBEAT_STALE_MS, displayMsisdn, reversalEntry, reversalEntryId, splitReversal } from "./core";
import { readFloatCents } from "../agents/float";
import { creditZaadTopup, releaseZaadHold } from "./settle";
import {
  ZAAD_AGENTS,
  ZAAD_AGENT_CUSTOMERS,
  ZAAD_AGENT_TOPUPS,
  ZaadAgentDoc,
  ZaadAgentTopup,
} from "./types";

const OPS = ["ops", "super"] as const;

function idOf(value: unknown, what: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new https.HttpsError("invalid-argument", `${what} required`);
  }
  return value;
}

/**
 * Record an agent's receiving Zaad number after checking it in person, and
 * switch them on or off. In: `{ agentId, receiveMsisdn, enabled, reason }`.
 * A changed number pauses the agent for `zaadAgentNumberChangePauseHours`.
 */
export const adminSetZaadAgent = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ receiveNumber: string; enabled: boolean; pausedUntil: string | null }>> => {
    const actor = requireAdmin(request, [...OPS]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const agentId = idOf(request.data?.agentId, "agentId");
    const msisdn = normaliseSomaliMsisdn(request.data?.receiveMsisdn);
    if (!msisdn) throw new https.HttpsError("invalid-argument", "Enter a Zaad number like 063 412 3456");
    const enabled = request.data?.enabled === true;

    const db = admin.firestore();
    const user = (await db.collection("users").doc(agentId).get()).data();
    if (!user || !isAgentRole(user.accountType)) {
      throw new https.HttpsError("failed-precondition", "Only agent accounts can take Zaad top-ups");
    }
    const taken = await db.collection(ZAAD_AGENTS).where("receiveMsisdn", "==", msisdn).limit(5).get();
    if (taken.docs.some((d) => d.id !== agentId)) {
      throw new https.HttpsError("already-exists", "Another agent already receives on this number");
    }
    const rates = await getRates();
    const ref = db.collection(ZAAD_AGENTS).doc(agentId);
    let pausedUntil: FirebaseFirestore.Timestamp | null = null;

    await db.runTransaction(async (tx) => {
      const prev = (await tx.get(ref)).data() as ZaadAgentDoc | undefined;
      const changed = !!prev?.receiveMsisdn && prev.receiveMsisdn !== msisdn;
      if (changed && prev?.openRequestId) {
        throw new https.HttpsError("failed-precondition", "The agent has a top-up in progress. Try again when it's done.");
      }
      const now = admin.firestore.Timestamp.now();
      pausedUntil = changed
        ? admin.firestore.Timestamp.fromMillis(now.toMillis() + rates.zaadAgentNumberChangePauseHours * 3600_000)
        : prev?.pausedUntil ?? null;
      const next: ZaadAgentDoc = {
        receiveMsisdn: msisdn,
        verifiedBy: actor.uid,
        verifiedAt: now,
        enabled,
        pausedUntil,
        online: enabled && !changed ? prev?.online ?? false : false,
        lastSeenAt: prev?.lastSeenAt ?? null,
        openRequestId: prev?.openRequestId ?? null,
        lastOfferedAt: prev?.lastOfferedAt ?? null,
        missedOffers: prev?.missedOffers ?? 0,
      };
      tx.set(ref, next);
      stageAuditEntry(tx, {
        actor,
        action: "zaad_agent.set",
        target: { type: "zaad_agent", id: agentId },
        reason,
        before: prev ? { receiveMsisdn: prev.receiveMsisdn, enabled: prev.enabled } : undefined,
        after: { receiveMsisdn: msisdn, enabled },
      });
    });
    const paused = pausedUntil as FirebaseFirestore.Timestamp | null;
    return {
      success: true,
      data: {
        receiveNumber: displayMsisdn(msisdn),
        enabled,
        pausedUntil: paused && paused.toMillis() > Date.now() ? paused.toDate().toISOString() : null,
      },
    };
  }
);

/**
 * Decide a disputed top-up. In: `{ requestId, outcome, reason }`.
 * "customer": the held float is credited to them (no commission), and the
 * ruling counts against the agent's standing. "agent": the float goes back
 * to the agent, and the customer gets a strike (D15).
 */
export const adminResolveZaadTopup = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ outcome: "customer" | "agent" }>> => {
    const actor = requireAdmin(request, [...OPS]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const id = idOf(request.data?.requestId, "requestId");
    const outcome = request.data?.outcome;
    if (outcome !== "customer" && outcome !== "agent") {
      throw new https.HttpsError("invalid-argument", "Decide for the customer or the agent");
    }
    const db = admin.firestore();
    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);

    const stage = (tx: FirebaseFirestore.Transaction, req: ZaadAgentTopup, now: FirebaseFirestore.Timestamp) => {
      tx.update(ref, { resolution: { outcome, by: actor.uid, reason, at: now } });
      if (outcome === "agent") {
        tx.set(
          db.collection(ZAAD_AGENT_CUSTOMERS).doc(req.customerId),
          { strikes: admin.firestore.FieldValue.arrayUnion(now.toMillis()) },
          { merge: true }
        );
      }
      stageAuditEntry(tx, {
        actor,
        action: `zaad_agent_topup.resolve_${outcome}`,
        target: { type: "zaad_agent_topup", id },
        reason,
      });
    };

    if (outcome === "customer") {
      const res = await creditZaadTopup(id, { uid: actor.uid, kind: "ops" }, ["disputed"], stage);
      if (!res.credited) throw new https.HttpsError("failed-precondition", "This top-up was already settled");
      const agentId = ((await ref.get()).data() as ZaadAgentTopup).agentId;
      await reviewAgentStanding(agentId);
    } else if (!(await releaseZaadHold(id, "ops_for_agent", actor.uid, ["disputed"], stage))) {
      throw new https.HttpsError("failed-precondition", "This top-up isn't disputed");
    }
    return { success: true, data: { outcome } };
  }
);

/**
 * Confirm or reject an agent's reversal report (D16). In: `{ requestId,
 * confirm, reason }`. Confirming repays the agent's float in full: from the
 * customer's wallet as far as it goes, the rest from Zapp's reversal losses.
 * The customer is blocked from agent top-ups.
 */
export const adminDecideZaadReversal = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ fromCustomerCents: number; fromZappCents: number } | { rejected: true }>> => {
    const actor = requireAdmin(request, [...OPS]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const id = idOf(request.data?.requestId, "requestId");
    const confirm = request.data?.confirm === true;
    const db = admin.firestore();
    const ref = db.collection(ZAAD_AGENT_TOPUPS).doc(id);
    let split = { fromCustomer: 0, fromZapp: 0 };
    let req: ZaadAgentTopup | null = null;

    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as ZaadAgentTopup | undefined;
      if (!fresh || fresh.status !== "completed" || !fresh.agentId || fresh.reversal?.status !== "reported") {
        throw new https.HttpsError("failed-precondition", "There's no reversal waiting on this top-up");
      }
      const now = admin.firestore.Timestamp.now();
      if (!confirm) {
        tx.update(ref, {
          reversal: { ...fresh.reversal, status: "rejected", decidedBy: actor.uid, decidedAt: now, decisionReason: reason },
          updatedAt: now,
        });
        stageAuditEntry(tx, { actor, action: "zaad_agent_topup.reversal_rejected", target: { type: "zaad_agent_topup", id }, reason });
        return;
      }
      const wallet = (await tx.get(db.collection("wallets").doc(fresh.customerId))).data() as Wallet | undefined;
      const balance = wallet ? walletPocket(wallet, "USD").balance : 0;
      split = splitReversal(fresh.amount, balance);
      const prepared = await prepareJournalEntry(
        tx,
        reversalEntry(id, fresh.agentId, fresh.customerId, split.fromCustomer, split.fromZapp, actor.uid)
      );
      if (prepared.alreadyPosted) return;
      prepared.write(tx);
      tx.update(ref, {
        reversal: {
          ...fresh.reversal,
          status: "confirmed",
          decidedBy: actor.uid,
          decidedAt: now,
          decisionReason: reason,
          fromCustomerCents: split.fromCustomer,
          fromZappCents: split.fromZapp,
          entryId: reversalEntryId(id),
        },
        updatedAt: now,
      });
      tx.set(
        db.collection(ZAAD_AGENT_CUSTOMERS).doc(fresh.customerId),
        { blocked: true, blockedReason: "reversal", blockedAt: now },
        { merge: true }
      );
      stageAuditEntry(tx, {
        actor,
        action: "zaad_agent_topup.reversal_confirmed",
        target: { type: "zaad_agent_topup", id },
        reason,
        journalEntryId: reversalEntryId(id),
        after: { fromCustomerCents: split.fromCustomer, fromZappCents: split.fromZapp },
      });
      req = fresh;
    });

    if (!confirm) return { success: true, data: { rejected: true } };
    const done = req as ZaadAgentTopup | null;
    if (done?.agentId) {
      notifyUser(
        done.agentId,
        "zaad_agent_topup",
        { key: "zaadAgent.reversal_repaid", params: { amount: pushAmount(done.amount, done.currency) } },
        { type: "zaad_agent_topup", requestId: id }
      ).catch((err) => console.error("zaadAgent notify failed:", err));
    }
    return { success: true, data: { fromCustomerCents: split.fromCustomer, fromZappCents: split.fromZapp } };
  }
);

/** Let a blocked customer use agent top-ups again. In: `{ userId, reason }`. */
export const adminClearZaadCustomer = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ cleared: true }>> => {
    const actor = requireAdmin(request, [...OPS]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const userId = idOf(request.data?.userId, "userId");
    const db = admin.firestore();
    const ref = db.collection(ZAAD_AGENT_CUSTOMERS).doc(userId);
    await db.runTransaction(async (tx) => {
      const prev = (await tx.get(ref)).data();
      tx.set(ref, { strikes: [], blocked: false, blockedReason: admin.firestore.FieldValue.delete() }, { merge: true });
      stageAuditEntry(tx, {
        actor,
        action: "zaad_agent_customer.clear",
        target: { type: "user", id: userId },
        reason,
        before: prev ? { blocked: !!prev.blocked, strikes: (prev.strikes ?? []).length } : undefined,
      });
    });
    return { success: true, data: { cleared: true } };
  }
);

const ms = (t: FirebaseFirestore.Timestamp | null | undefined) => (t ? t.toMillis() : null);

/** One request as the console shows it. */
export interface ZaadTopupRow {
  id: string;
  status: ZaadAgentTopup["status"];
  /** With the agent, or found by Zapp. Missing on older requests: remote. */
  meeting: "in_person" | "remote";
  amountCents: number;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  agentId: string | null;
  agentName: string | null;
  agentReceiveNumber: string | null;
  allowedSenders: string[];
  customerZaadTxnId: string | null;
  agentAnswer: ZaadAgentTopup["agentAnswer"] | null;
  disputedBy: ZaadAgentTopup["disputedBy"] | null;
  disputeReason: string | null;
  offers: number;
  createdAt: number | null;
  acceptedAt: number | null;
  customerSentAt: number | null;
  agentAnsweredAt: number | null;
  disputedAt: number | null;
  completedAt: number | null;
  releasedAt: number | null;
  resolution: { outcome: "customer" | "agent"; reason: string; at: number | null } | null;
  reversal: {
    status: "reported" | "confirmed" | "rejected";
    note: string;
    agentZaadTxnId: string | null;
    reportedAt: number | null;
    fromCustomerCents: number | null;
    fromZappCents: number | null;
  } | null;
}

async function namesOf(uids: string[]): Promise<Map<string, { name: string; phone: string | null }>> {
  const db = admin.firestore();
  const unique = [...new Set(uids.filter(Boolean))];
  const snaps = await Promise.all(unique.map((uid) => db.collection("users").doc(uid).get()));
  return new Map(
    snaps.map((s) => [
      s.id,
      {
        name: (s.get("agentInfo.businessName") as string) || (s.get("fullName") as string) || s.id,
        phone: (s.get("phoneNumber") as string) ?? null,
      },
    ])
  );
}

function toRow(id: string, r: ZaadAgentTopup, names: Map<string, { name: string; phone: string | null }>): ZaadTopupRow {
  const customer = names.get(r.customerId);
  return {
    id,
    status: r.status,
    meeting: r.meeting ?? "remote",
    amountCents: r.amount,
    customerId: r.customerId,
    customerName: customer?.name ?? r.customerFirstName,
    customerPhone: customer?.phone ? displayMsisdn(customer.phone) : null,
    agentId: r.agentId,
    agentName: r.agentId ? r.agentName ?? names.get(r.agentId)?.name ?? null : null,
    agentReceiveNumber: r.agentReceiveMsisdn ? displayMsisdn(r.agentReceiveMsisdn) : null,
    allowedSenders: (r.allowedSenders ?? []).map(displayMsisdn),
    customerZaadTxnId: r.customerZaadTxnId ?? null,
    agentAnswer: r.agentAnswer ?? null,
    disputedBy: r.disputedBy ?? null,
    disputeReason: r.disputeReason ?? null,
    offers: r.offers?.length ?? 0,
    createdAt: ms(r.createdAt),
    acceptedAt: ms(r.acceptedAt),
    customerSentAt: ms(r.customerSentAt),
    agentAnsweredAt: ms(r.agentAnsweredAt),
    disputedAt: ms(r.disputedAt),
    completedAt: ms(r.completedAt),
    releasedAt: ms(r.releasedAt),
    resolution: r.resolution ? { outcome: r.resolution.outcome, reason: r.resolution.reason, at: ms(r.resolution.at) } : null,
    reversal: r.reversal
      ? {
          status: r.reversal.status,
          note: r.reversal.note,
          agentZaadTxnId: r.reversal.agentZaadTxnId ?? null,
          reportedAt: ms(r.reversal.reportedAt),
          fromCustomerCents: r.reversal.fromCustomerCents ?? null,
          fromZappCents: r.reversal.fromZappCents ?? null,
        }
      : null,
  };
}

const OPEN_STATUSES: ZaadAgentTopup["status"][] = ["offered", "accepted", "customer_sent", "declined"];

/**
 * Requests for the console. In: `{ view }`: "attention" (disputes and
 * reversal reports waiting on ops), "open" (in progress), or "recent".
 * Also the money held for open requests and what reversals have cost Zapp.
 */
export const adminListZaadTopups = https.onCall(
  { enforceAppCheck: true },
  async (
    request
  ): Promise<ApiResponse<{ topups: ZaadTopupRow[]; heldCents: number; reversalLossCents: number }>> => {
    requireAdmin(request, [...OPS]);
    const db = admin.firestore();
    const col = db.collection(ZAAD_AGENT_TOPUPS);
    const view = request.data?.view;
    const docs =
      view === "recent"
        ? (await col.orderBy("createdAt", "desc").limit(100).get()).docs
        : view === "open"
          ? (await col.where("status", "in", OPEN_STATUSES).limit(200).get()).docs
          : [
              ...(await col.where("status", "==", "disputed").limit(100).get()).docs,
              ...(await col.where("reversal.status", "==", "reported").limit(100).get()).docs,
            ];
    const data = docs.map((d) => ({ id: d.id, r: d.data() as ZaadAgentTopup }));
    const names = await namesOf(data.flatMap(({ r }) => [r.customerId, r.agentId ?? ""]));
    const [hold, losses] = await Promise.all([
      db.collection(LEDGER_BALANCES_COLLECTION).doc(ZAAD_AGENT_HOLD).get(),
      db.collection(LEDGER_BALANCES_COLLECTION).doc(ZAAD_REVERSAL_LOSSES).get(),
    ]);
    return {
      success: true,
      data: {
        topups: data
          .map(({ id, r }) => toRow(id, r, names))
          .sort((a, b) => ((a.createdAt ?? 0) - (b.createdAt ?? 0)) * (view === "recent" ? -1 : 1)),
        heldCents: (hold.get("balance") as number) ?? 0,
        // The account goes negative by what reversals cost; shown as a positive loss.
        reversalLossCents: -((losses.get("balance") as number) ?? 0),
      },
    };
  }
);

/** One agent as the console shows it. */
export interface ZaadAgentRow {
  id: string;
  name: string;
  phone: string | null;
  receiveNumber: string | null;
  enabled: boolean;
  /** Online and their app checked in within the last few minutes. */
  online: boolean;
  lastSeenAt: number | null;
  pausedUntil: number | null;
  openRequestId: string | null;
  floatCents: number;
  flagged: boolean;
  verifiedAt: number | null;
}

/** Every agent set up for Zaad top-ups, with presence and float. */
export const adminListZaadAgents = https.onCall(
  { enforceAppCheck: true },
  async (request): Promise<ApiResponse<{ agents: ZaadAgentRow[] }>> => {
    requireAdmin(request, [...OPS]);
    const db = admin.firestore();
    const snap = await db.collection(ZAAD_AGENTS).limit(500).get();
    const nowMs = Date.now();
    const agents = await Promise.all(
      snap.docs.map(async (d) => {
        const a = d.data() as ZaadAgentDoc;
        const user = await db.collection("users").doc(d.id).get();
        const seen = ms(a.lastSeenAt);
        const paused = ms(a.pausedUntil);
        return {
          id: d.id,
          name: (user.get("agentInfo.businessName") as string) || (user.get("fullName") as string) || d.id,
          phone: user.get("phoneNumber") ? displayMsisdn(user.get("phoneNumber")) : null,
          receiveNumber: a.receiveMsisdn ? displayMsisdn(a.receiveMsisdn) : null,
          enabled: !!a.enabled,
          online: !!a.online && seen !== null && nowMs - seen <= HEARTBEAT_STALE_MS,
          lastSeenAt: seen,
          pausedUntil: paused && paused > nowMs ? paused : null,
          openRequestId: a.openRequestId ?? null,
          floatCents: await readFloatCents(d.id),
          flagged: !!user.get("agentFlag"),
          verifiedAt: ms(a.verifiedAt),
        };
      })
    );
    agents.sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
    return { success: true, data: { agents } };
  }
);

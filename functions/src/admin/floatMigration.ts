/**
 * One-off migration: split each agent's float out of their wallet
 * (AGENT_FLOAT_SEPARATION.md §4).
 *
 * Before the split, float lived in user:{uid} with everything else. From the
 * journal, an agent's float position is what the float desk issued, minus
 * what it withdrew, minus the cash-ins they gave, plus the cash-outs they
 * took. Commission is excluded: it's earnings and stays in the wallet.
 *
 * Preview first (apply: false), which posts nothing and shows each agent's
 * computed float, wallet and the amount that would move. The amount is the
 * computed float, never more than the wallet holds (an agent who has already
 * spent float on payouts can't move what isn't there) and never below zero.
 * Ops can override any agent's amount after checking it against the agent.
 * Applying posts one `float_move` entry per agent,
 * `float_migration_{uid}`: user:{uid} → agent:{uid}. It can only post once
 * per agent, so a rerun is harmless.
 *
 * Run it straight after deploying the split: until an agent's float is
 * migrated, their agent:{uid} is empty and their cash-ins are refused for
 * insufficient float.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import {
  JOURNAL_COLLECTION,
  PLATFORM_FEES,
  CASHOUT_HOLD,
  JournalLine,
  prepareJournalEntry,
  userAccount,
  agentAccount,
  InsufficientBalanceError,
} from "../ledger";
import { floatRef } from "../agents/float";

const FLOAT_ENTRY_TYPES = ["float_issue", "float_withdraw", "agent_topup", "agent_cashout"];

export function migrationEntryId(uid: string): string {
  return `float_migration_${uid}`;
}

/**
 * The float part of one pre-split entry for this agent. Only the agent's
 * side of an agent flow counts; an agent can also be someone else's customer.
 *
 * - float_issue / float_withdraw: the wallet's net change.
 * - agent_topup: what the agent gave (their debits). A credit is either
 *   commission or this agent being cashed in by another agent; neither is float.
 * - agent_cashout: only the settle step, where platform:cashout_hold pays the
 *   agent; the agent's credits less the commission platform:fees paid them.
 *   The hold step debits the *customer*, which may be this agent cashing out
 *   at someone else.
 */
export function floatDeltaOf(type: string, lines: JournalLine[], uid: string): number {
  const account = userAccount(uid);
  const mine = lines.filter((l) => l.account === account);
  if (mine.length === 0) return 0;
  const debits = mine.reduce((sum, l) => sum + l.debit, 0);
  const credits = mine.reduce((sum, l) => sum + l.credit, 0);
  switch (type) {
    case "float_issue":
    case "float_withdraw":
      return credits - debits;
    case "agent_topup":
      return debits === 0 ? 0 : -debits;
    case "agent_cashout": {
      const settle = lines.some((l) => l.account === CASHOUT_HOLD && l.debit > 0);
      if (!settle) return 0;
      const commission = lines.find((l) => l.account === PLATFORM_FEES && l.debit > 0)?.debit ?? 0;
      const paidToMe = commission > 0 && mine.some((l) => l.credit === commission);
      return credits - (paidToMe ? commission : 0);
    }
    default:
      return 0;
  }
}

export interface MigrationRow {
  agentId: string;
  fullName: string | null;
  /** Float the journal says they hold. */
  computedCents: number;
  /** Their wallet now. */
  walletCents: number;
  /** Their float account now (non-zero if already migrated or trading since). */
  floatCents: number;
  /** What would move (or moved) from wallet to float. */
  moveCents: number;
  alreadyMigrated: boolean;
  /** Set when the computed float is more than the wallet holds. */
  shortfallCents: number;
}

interface MigrateRequest {
  apply?: boolean;
  reason: string;
  /** uid → cents to move instead of the computed amount. */
  overrides?: Record<string, number>;
}

export const adminMigrateAgentFloat = https.onCall(
  { enforceAppCheck: true, timeoutSeconds: 300 },
  async (request: https.CallableRequest<MigrateRequest>): Promise<ApiResponse<{ applied: boolean; rows: MigrationRow[] }>> => {
    const apply = request.data?.apply === true;
    const actor = requireAdmin(request, apply ? "super" : ["super", "ops"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const overrides = request.data?.overrides ?? {};

    const db = admin.firestore();
    const agents = await db.collection("users").where("accountType", "in", ["topup_agent", "agent_merchant"]).limit(500).get();

    // Pre-split float entries, scanned once for every agent.
    const entries = await db.collection(JOURNAL_COLLECTION).where("type", "in", FLOAT_ENTRY_TYPES).get();
    const computed = new Map<string, number>();
    for (const e of entries.docs) {
      const { type, lines } = e.data() as { type: string; lines: JournalLine[] };
      for (const a of agents.docs) {
        const d = floatDeltaOf(type, lines, a.id);
        if (d !== 0) computed.set(a.id, (computed.get(a.id) ?? 0) + d);
      }
    }

    const rows: MigrationRow[] = [];
    for (const a of agents.docs) {
      const [walletSnap, floatSnap, done] = await Promise.all([
        db.collection("wallets").doc(a.id).get(),
        floatRef(a.id).get(),
        db.collection(JOURNAL_COLLECTION).doc(migrationEntryId(a.id)).get(),
      ]);
      const walletCents = (walletSnap.data()?.balance as number | undefined) ?? 0;
      const computedCents = computed.get(a.id) ?? 0;
      const wanted = Number.isInteger(overrides[a.id]) && overrides[a.id] >= 0 ? overrides[a.id] : computedCents;
      const moveCents = done.exists
        ? (done.data()!.lines as JournalLine[]).find((l) => l.account === agentAccount(a.id))?.credit ?? 0
        : Math.max(0, Math.min(wanted, walletCents));
      rows.push({
        agentId: a.id,
        fullName: a.data().fullName ?? null,
        computedCents,
        walletCents,
        floatCents: (floatSnap.data()?.balance as number | undefined) ?? 0,
        moveCents,
        alreadyMigrated: done.exists,
        shortfallCents: Math.max(0, computedCents - walletCents),
      });
    }

    if (apply) {
      for (const row of rows) {
        if (row.alreadyMigrated || row.moveCents <= 0) continue;
        try {
          await db.runTransaction(async (tx) => {
            const pending = await prepareJournalEntry(tx, {
              entryId: migrationEntryId(row.agentId),
              type: "float_move",
              currency: "USD",
              lines: [
                { account: userAccount(row.agentId), debit: row.moveCents, credit: 0 },
                { account: agentAccount(row.agentId), debit: 0, credit: row.moveCents },
              ],
              description: "Float separated from wallet",
              postedBy: actor.uid,
              // A frozen agent's float is still float; the split isn't spending.
              allowFrozenDebit: true,
            });
            if (pending.alreadyPosted) return;
            pending.write(tx);
            stageAuditEntry(tx, {
              actor,
              action: "float.migrate",
              target: { type: "user", id: row.agentId },
              reason,
              after: { moveCents: row.moveCents, computedCents: row.computedCents },
              journalEntryId: migrationEntryId(row.agentId),
            });
          });
          row.alreadyMigrated = true;
          row.floatCents += row.moveCents;
          row.walletCents -= row.moveCents;
        } catch (err) {
          // The wallet changed since the preview (or holds a dispute reserve):
          // leave this agent for a fresh preview rather than guess.
          if (!(err instanceof InsufficientBalanceError)) throw err;
          row.moveCents = 0;
        }
      }
    }

    rows.sort((x, y) => y.computedCents - x.computedCents);
    return { success: true, data: { applied: apply, rows } };
  }
);

/**
 * Admin audit log — `admin_audit`, append-only and server-only.
 *
 * Every admin callable records what it did here, in the same Firestore
 * transaction as the effect where one exists, so there is no window in which
 * an action succeeds unlogged. When the Bank of Somaliland asks who verified
 * a customer or who issued float to an agent, this collection is the answer.
 */

import * as admin from "firebase-admin";
import { AdminAuditEntry, AuditTargetType } from "./types";
import { AdminIdentity } from "./types";

export const ADMIN_AUDIT_COLLECTION = "admin_audit";

export interface AuditInput {
  actor: AdminIdentity;
  action: string;
  target: { type: AuditTargetType; id: string };
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  journalEntryId?: string;
}

function buildEntry(input: AuditInput): AdminAuditEntry {
  const entry: AdminAuditEntry = {
    actor: input.actor.uid,
    actorEmail: input.actor.email,
    action: input.action,
    target: input.target,
    reason: input.reason,
    at: admin.firestore.Timestamp.now(),
  };

  // Firestore rejects undefined values; only attach what was supplied.
  if (input.before) entry.before = input.before;
  if (input.after) entry.after = input.after;
  if (input.journalEntryId) entry.journalEntryId = input.journalEntryId;

  return entry;
}

/**
 * Stage an audit write on an existing transaction. Preferred: it makes the
 * log atomic with the change it describes.
 *
 * Returns the audit document id so the caller can surface it to the operator.
 */
export function stageAuditEntry(
  tx: FirebaseFirestore.Transaction,
  input: AuditInput
): string {
  const ref = admin.firestore().collection(ADMIN_AUDIT_COLLECTION).doc();
  tx.create(ref, buildEntry(input));
  return ref.id;
}

/**
 * Write an audit entry outside a transaction.
 *
 * Only for read-only actions worth recording (opening a KYC submission,
 * resolving a customer's details). Anything that mutates state should use
 * `stageAuditEntry` instead.
 */
export async function writeAuditEntry(input: AuditInput): Promise<string> {
  const ref = admin.firestore().collection(ADMIN_AUDIT_COLLECTION).doc();
  await ref.create(buildEntry(input));
  return ref.id;
}

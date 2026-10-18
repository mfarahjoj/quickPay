/**
 * One-off migration: move PIN secrets off users/{uid}
 * (ONBOARDING_SECURITY_REVIEW.md, finding A1).
 *
 * Accounts move on their own the next time their PIN is checked
 * (auth/pinStore.ts), but until then the hash stays readable by the phone.
 * This moves every remaining account at once.
 *
 * Preview first (apply: false): counts what would move and touches nothing.
 * Applying (super admin only) copies each account's secrets into
 * users/{uid}/private/auth, sets `hasPin`, and deletes the fields from
 * users/{uid}, leaving only the placeholder older app builds look for. A rerun
 * finds nothing left to move.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { writeAuditEntry } from "./audit";
import { AUTH_FIELDS, AuthSecrets, LEGACY_PIN_PLACEHOLDER, authRef, isStoredPinHash, writeAuth } from "../auth/pinStore";

export interface AuthMigrationResult {
  applied: boolean;
  scanned: number;
  /** Accounts with secrets still on users/{uid}. */
  toMove: number;
  /** Of those, how many have a real PIN hash. */
  withPin: number;
  moved: number;
}

/** The secrets still sitting on a users/{uid} doc, if any. */
export function legacySecretsOf(user: FirebaseFirestore.DocumentData): AuthSecrets | null {
  const out: Record<string, unknown> = {};
  for (const f of AUTH_FIELDS) {
    if (user[f] === undefined) continue;
    if (f === "pinHash" && (user[f] === LEGACY_PIN_PLACEHOLDER || user[f] === "")) continue;
    out[f] = user[f];
  }
  // An empty pinHash from onCreate is junk, not a secret, but it should still go.
  const junk = user.pinHash === "";
  return Object.keys(out).length > 0 || junk ? (out as AuthSecrets) : null;
}

const PAGE = 300;

export const adminMigrateAuthSecrets = https.onCall(
  { enforceAppCheck: true, timeoutSeconds: 540 },
  async (request: https.CallableRequest<{ apply?: boolean; reason: string }>): Promise<ApiResponse<AuthMigrationResult>> => {
    const apply = request.data?.apply === true;
    const actor = requireAdmin(request, apply ? "super" : ["super", "ops"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);

    const db = admin.firestore();
    const result: AuthMigrationResult = { applied: apply, scanned: 0, toMove: 0, withPin: 0, moved: 0 };

    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let q = db.collection("users").orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
      if (last) q = q.startAfter(last);
      const page = await q.get();
      if (page.empty) break;
      last = page.docs[page.docs.length - 1];

      const batch = db.batch();
      let writes = 0;
      for (const doc of page.docs) {
        result.scanned += 1;
        const legacy = legacySecretsOf(doc.data());
        if (!legacy) continue;
        result.toMove += 1;
        const hasPin = isStoredPinHash(legacy.pinHash);
        if (hasPin) result.withPin += 1;
        if (!apply) continue;
        // The private doc wins where both exist: it's the newer copy.
        const current = (await authRef(doc.id).get()).data() as AuthSecrets | undefined;
        writeAuth(batch, doc.id, { ...legacy, ...current }, { hasPin: hasPin || isStoredPinHash(current?.pinHash) });
        writes += 1;
      }
      if (writes > 0) {
        await batch.commit();
        result.moved += writes;
      }
      if (page.size < PAGE) break;
    }

    if (apply) {
      await writeAuditEntry({
        actor,
        action: "auth.migrateSecrets",
        target: { type: "migration", id: "auth_secrets" },
        reason,
        after: { moved: result.moved, withPin: result.withPin },
      });
    }
    return { success: true, data: result };
  }
);

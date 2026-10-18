/**
 * Where PIN secrets live (ONBOARDING_SECURITY_REVIEW.md, finding A1).
 *
 * They used to sit on users/{uid}, which the owner may read, so every
 * profile load sent the bcrypt PIN hash to the phone, and anyone with a
 * session could brute-force a 6-digit PIN offline, past the lockout. Now
 * they live in users/{uid}/private/auth, which no client can read or write
 * (firestore.rules). users/{uid} keeps only `hasPin`, which is all the apps
 * need.
 *
 * Accounts from before the move still have the fields on users/{uid}.
 * `readAuth` falls back to them, and every write through `writeAuth` also
 * deletes them, so each account moves the next time its PIN is used;
 * adminMigrateAuthSecrets moves the rest in one go.
 *
 * App builds from before the move decide "has a PIN" by looking at
 * users/{uid}.pinHash (the customer app: non-empty; the merchant app: starts
 * with "$2" and is 20+ characters). So `pinHash` there becomes
 * LEGACY_PIN_PLACEHOLDER rather than disappearing. It's no hash of anything
 * (bcrypt has no cost 00), and readAuth ignores it.
 */

import * as admin from "firebase-admin";

/** The fields that moved, and are deleted from users/{uid} on write. */
export const AUTH_FIELDS = [
  "pinHash",
  "pinFailedAttempts",
  "pinLockedUntil",
  "pinHardLocked",
  "pinResetAt",
  "pinResetHistory",
  "resetIdFailedAttempts",
  "resetIdLockedUntil",
] as const;

/** What users/{uid}.pinHash holds once the real hash has moved. */
export const LEGACY_PIN_PLACEHOLDER = "$2b$00$moved.to.server.only.auth.store";

export interface AuthSecrets {
  pinHash?: string;
  /** Wrong PINs in a row; cleared by a correct one. */
  pinFailedAttempts?: number;
  pinLockedUntil?: FirebaseFirestore.Timestamp | null;
  /** Set at the hard-lock threshold; only a PIN reset clears it (A3). */
  pinHardLocked?: boolean;
  pinResetAt?: FirebaseFirestore.Timestamp;
  pinResetHistory?: FirebaseFirestore.Timestamp[];
  resetIdFailedAttempts?: number;
  resetIdLockedUntil?: FirebaseFirestore.Timestamp | null;
}

export function authRef(uid: string): FirebaseFirestore.DocumentReference {
  return admin.firestore().collection(`users/${uid}/private`).doc("auth");
}

function legacyFrom(user: FirebaseFirestore.DocumentData | undefined): AuthSecrets {
  const out: Record<string, unknown> = {};
  for (const f of AUTH_FIELDS) if (user && user[f] !== undefined) out[f] = user[f];
  if (out.pinHash === LEGACY_PIN_PLACEHOLDER || out.pinHash === "") delete out.pinHash;
  return out as AuthSecrets;
}

/**
 * The account's PIN secrets: the private doc, with any field it doesn't have
 * yet taken from the legacy copy on users/{uid}.
 */
export async function readAuth(
  uid: string,
  tx?: FirebaseFirestore.Transaction,
  userData?: FirebaseFirestore.DocumentData
): Promise<AuthSecrets> {
  const ref = authRef(uid);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const user =
    userData ??
    (tx ? (await tx.get(admin.firestore().collection("users").doc(uid))).data() : (await admin.firestore().collection("users").doc(uid).get()).data());
  return { ...legacyFrom(user), ...(snap.data() as AuthSecrets | undefined) };
}

/**
 * Write PIN secrets to the private doc and drop any legacy copy from
 * users/{uid}, keeping its `hasPin` flag in step.
 */
export function writeAuth(
  tx: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
  uid: string,
  fields: Partial<AuthSecrets>,
  opts: { hasPin?: boolean } = {}
): void {
  (tx as FirebaseFirestore.Transaction).set(authRef(uid), fields, { merge: true });
  const userUpdate: Record<string, unknown> = Object.fromEntries(
    AUTH_FIELDS.map((f) => [f, admin.firestore.FieldValue.delete()])
  );
  // A write that carries the hash also settles `hasPin`.
  const hasPin = opts.hasPin ?? (isStoredPinHash(fields.pinHash) ? true : undefined);
  if (hasPin !== undefined) {
    userUpdate.hasPin = hasPin;
    if (hasPin) userUpdate.pinHash = LEGACY_PIN_PLACEHOLDER;
  } else {
    // Without the hash in hand, leave users/{uid}.pinHash alone: callers
    // that might meet a legacy account pass the whole readAuth record.
    delete userUpdate.pinHash;
  }
  (tx as FirebaseFirestore.Transaction).set(admin.firestore().collection("users").doc(uid), userUpdate, { merge: true });
}

/** True when the account has a usable PIN hash (bcrypt, peppered or not). */
export function isStoredPinHash(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value !== LEGACY_PIN_PLACEHOLDER &&
    /^(p1\$)?\$2[aby]?\$/.test(value) &&
    value.length >= 20
  );
}

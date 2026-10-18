/**
 * Reading an agent's float (AGENT_FLOAT_SEPARATION.md). The ledger enforces
 * that float never goes negative; this is for a clear message before that.
 */

import * as admin from "firebase-admin";
import { agentAccount, LEDGER_BALANCES_COLLECTION } from "../ledger";

export function floatRef(agentId: string): FirebaseFirestore.DocumentReference {
  return admin.firestore().collection(LEDGER_BALANCES_COLLECTION).doc(agentAccount(agentId));
}

/** Cents of float this agent holds, read inside a transaction or outside. */
export async function readFloatCents(agentId: string, tx?: FirebaseFirestore.Transaction): Promise<number> {
  const snap = tx ? await tx.get(floatRef(agentId)) : await floatRef(agentId).get();
  return (snap.data()?.balance as number | undefined) ?? 0;
}

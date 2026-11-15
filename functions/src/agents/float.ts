/**
 * Reading an agent's float (AGENT_FLOAT_SEPARATION.md). The ledger enforces
 * that float never goes negative; this is for a clear message before that.
 *
 * An agent holds float in each currency separately (SHILLINGS.md): dollars in
 * `agent:{uid}`, shillings in `agent:{uid}@SLS`. Neither is ever converted
 * into the other, so a cash-in in shillings needs shilling float.
 */

import * as admin from "firebase-admin";
import { agentAccount, balanceKey, LedgerCurrency, LEDGER_BALANCES_COLLECTION } from "../ledger";

export function floatRef(agentId: string, currency: LedgerCurrency = "USD"): FirebaseFirestore.DocumentReference {
  return admin.firestore().collection(LEDGER_BALANCES_COLLECTION).doc(balanceKey(agentAccount(agentId), currency));
}

/**
 * This agent's float in [currency], in its smallest unit (cents, or whole
 * shillings), read inside a transaction or outside.
 */
export async function readFloatCents(
  agentId: string,
  tx?: FirebaseFirestore.Transaction,
  currency: LedgerCurrency = "USD"
): Promise<number> {
  const ref = floatRef(agentId, currency);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return (snap.data()?.balance as number | undefined) ?? 0;
}

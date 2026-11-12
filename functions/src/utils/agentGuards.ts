import { https } from "firebase-functions/v2";
import { assertAccountActive, AccountStatusFields } from "./accountStatus";
import { isPrivilegedRole } from "./roles";

/**
 * Who an agent may cash in.
 *
 * Every cash-in pays the agent a commission out of platform:fees, so any way
 * for the value to come back to the agent without real cash changing hands
 * mints money:
 *
 * - **Self top-up.** With the agent on both sides, the float debit and the
 *   customer credit net to zero on one wallet and only the commission is
 *   left, paid on every call without any float being spent.
 * - **Agent-to-agent.** Two agents topping each other up just move float
 *   back and forth, and each collects commission on every move.
 *
 * So the recipient must be a different account, held by a plain customer
 * rather than any privileged role, and active. Only agents (or merchants
 * through their own flows) hold the privileged roles, so this also keeps
 * float from moving between businesses through a customer cash-in.
 *
 * The self-top-up message contains "own top-up" because the merchant app
 * matches on it (merchant-app/src/utils/errors.ts → errors.ownTopup).
 */
export function assertCashInRecipient(
  agentId: string,
  recipientId: string,
  recipient: (AccountStatusFields & { accountType?: unknown }) | undefined
): void {
  if (agentId === recipientId) {
    throw new https.HttpsError(
      "permission-denied",
      "Agents cannot make their own top-up."
    );
  }
  if (isPrivilegedRole(recipient?.accountType)) {
    throw new https.HttpsError(
      "permission-denied",
      "Top-ups can only go to customer accounts."
    );
  }
  assertAccountActive(recipient, "counterparty");
}

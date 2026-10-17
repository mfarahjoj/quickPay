/**
 * Business names are locked once an account is a merchant or agent.
 *
 * The name is what a customer checks before entering their PIN: the confirm
 * screen, the charge prompt and the receipt all show it. A shop that could
 * rename itself after building trust could take the name of the shop next
 * door, and every payment would still look right. So privileged accounts
 * change their name only through ops (`adminRenameMerchant`), never from an
 * app. Customers keep renaming freely.
 */

import { https } from "firebase-functions/v2";
import { isPrivilegedRole } from "./roles";

/** True when this account's name may only be changed by ops. */
export function isNameLocked(accountType: unknown): boolean {
  return isPrivilegedRole(accountType);
}

/**
 * Throw if `newName` would rename a locked account. Re-sending the current
 * name is allowed, so an onboarding step that repeats it doesn't fail.
 */
export function assertNameChangeAllowed(
  user: { accountType?: unknown; fullName?: unknown } | undefined,
  newName: string
): void {
  if (!user || !isNameLocked(user.accountType)) return;
  if (typeof user.fullName === "string" && user.fullName.trim() === newName.trim()) return;
  throw new https.HttpsError(
    "failed-precondition",
    "Business names can only be changed by Zapp Pay support.",
    { reason: "name_locked" }
  );
}

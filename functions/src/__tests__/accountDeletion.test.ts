import * as admin from "firebase-admin";
import { deletionDue, isOrphanAuthUser, tombstone, ORPHAN_AUTH_MAX_AGE_MS } from "../auth/deleteAccount";

const NOW = Date.UTC(2026, 9, 25, 2);
const ts = (ms: number) => admin.firestore.Timestamp.fromMillis(ms);

describe("account deletion", () => {
  it("is due once the wait is over, and only once", () => {
    expect(deletionDue({ deletionDueAt: ts(NOW - 1) }, NOW)).toBe(true);
    expect(deletionDue({ deletionDueAt: ts(NOW + 1) }, NOW)).toBe(false);
    expect(deletionDue({ deletionDueAt: ts(NOW - 1), deleted: true }, NOW)).toBe(false);
    expect(deletionDue({}, NOW)).toBe(false);
    expect(deletionDue(undefined, NOW)).toBe(false);
  });

  it("leaves nothing that names the person", () => {
    const t = tombstone(
      {
        fullName: "Hodan Ali",
        phoneNumber: "+252634000001",
        email: "h@example.com",
        linkedAccounts: { zaadPhone: "+252634000001" },
        accountType: "customer",
        deletionRequestedAt: ts(NOW - 30 * 86400000),
      },
      NOW
    );
    expect(JSON.stringify(t)).not.toMatch(/Hodan|252634000001|example\.com/);
    expect(t).toMatchObject({ deleted: true, fullName: "Deleted account", isActive: false, accountType: "customer" });
  });
});

describe("abandoned sign-ups", () => {
  const signedIn = (msAgo: number) => ({
    metadata: { creationTime: new Date(NOW - msAgo).toUTCString(), lastSignInTime: new Date(NOW - msAgo).toUTCString() },
  });

  it("removes a week-old sign-in with no account behind it", () => {
    expect(isOrphanAuthUser(signedIn(ORPHAN_AUTH_MAX_AGE_MS + 60_000), false, NOW)).toBe(true);
  });

  it("keeps recent ones (still choosing a PIN) and anything with an account", () => {
    expect(isOrphanAuthUser(signedIn(3600_000), false, NOW)).toBe(false);
    expect(isOrphanAuthUser(signedIn(ORPHAN_AUTH_MAX_AGE_MS + 60_000), true, NOW)).toBe(false);
    expect(isOrphanAuthUser({ metadata: {} }, false, NOW)).toBe(false);
  });
});

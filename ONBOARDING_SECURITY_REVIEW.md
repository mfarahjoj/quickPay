# Onboarding, sign-in and PIN security review

**Date:** 2026-10-18
**Scope:** both apps and the backend. Sign-up, sign-in, PIN setup, change and reset, trusted devices, biometrics, app lock and sessions.
**Short answer:** the customer app's PIN-reset design is better than most: SIM-swap aware, rate-limited, with a cooling-off pause. The gaps are elsewhere:
- **One critical leak:** every phone downloads its own PIN hash.
- **The merchant app has no PIN maintenance at all:** no change, no reset, no app lock.
- **Sessions never end.**
- **The PIN sits in the Keychain** behind an app-level biometric prompt.

**Fix the leak before the next deploy.**

**Status (2026-10-18):** items 1–15 are built on `fix/wallet-phase1`, one commit each, and **not deployed**. Decisions used the suggested defaults:
- O1: hard lock at 10.
- O2: sign out after 30 days.
- O3: 5 phones, forgotten after 180 days.
- O4: +252 and +44 for now. The diaspora list is still to decide.
- O5: role approval counts as verified ID.

O1–O3 are editable in the console under "Sign-in and devices". Before and after deploying, follow SECURITY_CONSOLE_CHECKLIST.md: the PIN_PEPPER secret, the Token Creator grant, and the PIN-secrets migration.

---

## 1. How it works today

| Step | Customer app | Merchant app | Backend |
|---|---|---|---|
| Sign up | Phone → SMS code (Firebase Auth) → name → PIN ×2 → optional Face ID | Phone → SMS code → role and business details → PIN → admin approval | `setupPin` creates the user and wallet and hashes the PIN (bcrypt, cost 12) |
| Sign in, known phone | Trusted-device secret (Keychain) + PIN → custom token, no SMS | SMS code every time | `loginWithPin` |
| Sign in, new phone | SMS code, then the PIN | SMS code | Firebase Auth |
| App lock | PIN or Face ID every time the app returns from the background | **None** | `validateUserPin` |
| Wrong PIN | 5 tries → locked 60 s, doubling, capped at 15 min, repeating | same | `verifyUserPin`, race-safe |
| Change PIN | Security → current + new PIN | **None** | `changePin` |
| Forgot PIN | SMS + (trusted phone ≥ 7 days **or** last 4 of verified ID), then a 24 h pause on sending, other devices dropped, owner notified, at most 1 per day and 3 per 30 days | **None** | `resetPin` |
| Lost phone | Freeze my account; revoke all devices | Support only | `freezeMyAccount`, `revokeTrustedDevices` |

Already done well:
- Lockout counting is race-safe.
- The reset flow is SIM-swap aware.
- App Check is enforced on every callable.
- Trusted-device login is two factors: what the phone holds and what the person knows.
- Accounts can be deleted from the app.

## 2. Findings

### Critical

**A1. The phone downloads its own PIN hash.**
- `firestore.rules` lets the owner read their whole `users/{uid}` doc, which holds `pinHash`.
- Both apps subscribe to that doc (`mobile/src/hooks/useUserProfile.ts`, `merchant-app/src/hooks/useMerchantProfile.ts`), so the hash reaches the phone on every profile load.
- A 6-digit PIN has 1,000,000 possibilities. Cracking a bcrypt cost-12 hash of one offline on a GPU takes minutes to hours, and the server's lockout never sees it.
- Anyone with a signed-in session can do this: a stolen unlocked phone, malware, or a leaked token.
- The same doc also exposes the lockout counters and reset state.

*Industry standard:* PIN verifiers never leave the server. NIST SP 800-63B §5.1.1.2 also asks for an extra keyed hash with a secret held only by the verifier (a "pepper"), so a database leak alone isn't enough.

### High

**A2. Wrong PINs never lead to a hard lock.** After 5 failures the lock lasts 60 seconds and doubles up to 15 minutes, then repeats forever. That's about 96 guesses a day, every day, against any account an attacker has a session for. Mobile-money operators lock the PIN outright after a few failures and need re-verification to unlock (an SMS code plus ID, or a branch or agent visit).

**A3. Merchants can't maintain their PIN.** The merchant app has no change PIN, no forgotten PIN, no app lock, no biometrics and no security settings.
- A merchant who forgets their PIN can't pay out, refund or confirm cash-ins and cash-outs until support steps in.
- Anyone who picks up an unlocked merchant phone sees the dashboard, sales and customer details.

**A4. The PIN is stored on the phone (security item #10).** Face ID unlock works by keeping the PIN in the Keychain, readable once an in-app prompt succeeds (`biometric.service.ts`). The hardware doesn't enforce the biometric check: a jailbroken or instrumented phone can read the PIN directly, and the trusted-device secret is on the same phone. *Industry standard:* a key created in the Secure Enclave or StrongBox, usable only after a biometric check, signs a challenge from the server. The PIN is never stored, and the server keeps only the public key.

**A5. Sessions never end, and nothing ends them.**
- A Firebase session refreshes indefinitely.
- PIN reset, PIN change, Revoke devices, Freeze and the admin freeze leave every existing session signed in (no `revokeRefreshTokens`, security-plan Phase 4 low).
- There's no idle timeout. Money still needs the PIN, but a forgotten session keeps the account's data open.

### Medium

**B1. Weak PINs are only checked in the app.** A short client-side list and all-same digits are refused, but the server accepts `123456`, `000000`, `121212` and birth years from any other client. NIST 800-63B asks verifiers to reject commonly used values.

**B2. Changing the PIN is silent.** Nobody is notified, other devices and sessions stay signed in, and the server doesn't apply the weak-PIN check.

**B3. Trusted devices are loose.**
- Registering one needs no PIN.
- There's no limit on how many an account can have, and they never expire, even unused for months.
- There's no list of devices and no way to remove just one.
- Nobody is told when a new device signs in.
- Banking apps show a device list and send a new-device alert.

**B4. No record of consent.** Acceptance of the terms and privacy policy (and which version) isn't stored. App reviewers and regulators expect that.

**B5. No way to change phone number.** The phone number is the identity. Someone who loses their SIM and gets a new number has a new, empty account, and their money is stuck until support moves it by hand.

**B6. PIN and code screens can be captured.** There's no Android `FLAG_SECURE` and no blurring of the iOS app-switcher snapshot on PIN, code or balance screens.

**B7. No device-integrity signal.** Rooted and jailbroken phones aren't flagged. App Check already runs Play Integrity and App Attest, but only proves the app is genuine, not that the device is.

**B8. SMS-code abuse controls can't be checked from the repo.** Firebase Auth's SMS region policy (allow only +252 and the diaspora countries you serve), App Check enforcement for Auth, and SMS quota alerts are console settings. SMS pumping is the most common cost attack on phone-auth apps.

**B9. PIN login is broken in prod** until the functions' service account gets *Service Account Token Creator* (BACKLOG). Until then every customer signs in by SMS.

### Low

- A 6-digit PIN is the right length; keep it.
- The SMS resend countdown exists only in the app; Firebase's own quotas are the real limit.

## 3. Plan

### Phase A: before the next deploy

1. **Move auth secrets off the readable doc (A1).**
   - `pinHash`, lockout counters, reset history and reset-ID state move to `users/{uid}/private/auth`. The rules deny all client access to it.
   - Stored hashes are moved over, and the old fields deleted, by a one-off migration callable with a preview first.
2. **Pepper the PIN (A1).** New hashes are `bcrypt(HMAC-SHA256(pepper, pin))`, with the pepper in Secret Manager. Old hashes are upgraded the next time that PIN is verified correctly.
3. **Hard lock (A2).** After 10 failures in a row the PIN is locked until it's reset: SMS plus a trusted device or ID, as today, or an agent or support visit. The escalating short locks stay for failures 5–9.
4. **Server-side weak-PIN check (B1).** Blocklist the most common PINs, plus all-same digits, runs of sequential digits, repeated pairs and years 1940–2010. Applied in `setupPin`, `changePin` and `resetPin`.
5. **End sessions when it matters (A5, B2).** `revokeRefreshTokens` on PIN reset, PIN change, Revoke devices, Freeze my account and the admin freeze. Notify the owner on every PIN change.

### Phase B: merchant parity (A3)

6. Change PIN, Forgot PIN and app lock in the merchant app, using the same backend as the customer app. For the reset, a merchant's in-person role approval counts as verified identity.
7. A Security section in merchant Settings covering PIN, devices and Face ID.

### Phase C: devices and sessions (B3, A5)

8. Registering a device needs the PIN. At most 5 devices per account. Devices expire after 180 days unused.
9. A device list in both apps: name, platform, last used, remove one. Plus a new-device sign-in alert (push to the other devices, and an SMS).
10. Sign out after 30 days without use: a new SMS code, or a trusted device plus the PIN.

### Phase D: biometrics done properly (A4, item #10)

11. Biometric unlock and payment approval use a hardware key that needs Face ID or a fingerprint to use. It signs a challenge from the server, which keeps only the public key. Remove the stored PIN. Older builds keep working by entering the PIN.

### Phase E: completeness

12. Record acceptance of the terms and privacy policy, with version and time (B4). New versions are re-prompted.
13. Change phone number (B5): new number by SMS, plus the PIN, plus the old number if it's still reachable or the verified ID. The money moves with the account; a 7-day pause on sending follows.
14. Protect PIN, code and balance screens from screenshots (B6), and add a device-integrity check that raises a risk signal rather than blocking (B7).
15. Console checklist (B8, B9): SMS region policy, App Check for Auth, SMS quota alerts, and the token-creator IAM grant.

## 4. Decisions for you

| | Decision | Suggestion |
|---|---|---|
| O1 | Hard-lock threshold | 10 wrong PINs in a row |
| O2 | Session lifetime without use | 30 days |
| O3 | Devices per account | 5, expiring after 180 days unused |
| O4 | SMS countries allowed | +252, and the diaspora countries you name |
| O5 | Merchant forgot-PIN identity | Role approval counts as verified ID |

## References

- NIST SP 800-63B, Digital Identity Guidelines: memorized secrets (blocklists, rate limiting, keyed hashing with a verifier-only secret). <https://pages.nist.gov/800-63-3/sp800-63b.html>
- OWASP MASVS v2: MASVS-AUTH (authentication), MASVS-STORAGE (no secrets on device), MASVS-RESILIENCE (device integrity). <https://mas.owasp.org/MASVS/>
- Firebase Auth: SMS region policy and abuse prevention for phone sign-in. <https://firebase.google.com/docs/auth/web/phone-auth>
- Firebase Admin `revokeRefreshTokens` for ending sessions. <https://firebase.google.com/docs/auth/admin/manage-sessions>

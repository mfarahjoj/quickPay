# Security console checklist

**Date:** 2026-10-18
**Scope:** ONBOARDING_SECURITY_REVIEW.md item 15 (B8, B9). These are settings in the Firebase and Google Cloud consoles that the repo can't hold. It also lists what the onboarding work (items 1–14, on `fix/wallet-phase1`) needs before and after it's deployed.
**Project:** `quickpay-485417`

Tick each one off when it's done in the console.

---

## 1. Before deploying the onboarding work

- [ ] **Create the PIN pepper** (item 2). Every function is bound to it, so the deploy fails without it. Hashing a PIN also fails closed without it.
  ```bash
  openssl rand -hex 32 | firebase functions:secrets:set PIN_PEPPER --data-file=- --project quickpay-485417
  ```
  Never change or delete it. Every PIN set from then on depends on it, and a lost pepper means every customer must reset their PIN. Rotating it later needs a planned `p2$` prefix (see `functions/src/utils/encryption.ts`).

- [ ] **Grant Service Account Token Creator to the functions' service account** (B9). Without it `createCustomToken` fails, which breaks three things:
  - PIN sign-in on a trusted phone.
  - Signing straight back in after a PIN change, reset or device removal. The phone is signed out within the hour instead.
  - Phone-number change, which also needs it to keep the caller signed in.

  Find the project number with `gcloud projects describe quickpay-485417 --format='value(projectNumber)'`. Then:
  ```bash
  gcloud iam service-accounts add-iam-policy-binding \
    PROJECT_NUMBER-compute@developer.gserviceaccount.com \
    --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
    --role=roles/iam.serviceAccountTokenCreator \
    --project quickpay-485417
  ```
  Use the service account the functions actually run as. Check one function in Cloud Run, under Security.

- [ ] **Deploy functions and rules together, from the pushed commit, by name.** Rules and functions must land together because the rules now deny `users/{uid}/private/*`, `biometricKeys`, `biometricChallenges`, `phoneChanges` and `deviceRiskReports`. New functions:
  - `adminMigrateAuthSecrets`
  - `listMyDevices`, `removeMyDevice`, `renameMyDevice`
  - `expireIdleSessions`
  - `registerBiometricKey`, `removeBiometricKey`, `biometricChallenge`, `approveBiometric`
  - `acceptTerms`
  - `reportDeviceRisk`
  - `startPhoneChange`, `completePhoneChange`

  Changed functions: everything that checks a PIN, plus `setupPin`, `changePin`, `resetPin`, `registerTrustedDevice`, `loginWithPin`, `revokeTrustedDevices`, `freezeMyAccount`, `adminSetAccountStatus`, `adminRevokeUserDevices`, `adminClearLockouts`, `adminGetUser` and `adminReviewRoleRequest`. Because PIN checks are behind money movement, this is a money-flow deploy and needs explicit per-target authorization (CLAUDE.md).

## 2. Straight after deploying

- [ ] **Move PIN secrets off the profile** (item 1). In the console, open Pricing and use "Move PIN secrets server-side": Preview, then a super admin applies it. Until then, accounts that haven't used their PIN since the deploy still have their hash on the doc the phone reads.
- [ ] **Separate agent float**, if not done yet (AGENT_FLOAT_SEPARATION.md): float desk, then "Separate agent float from wallets".
- [ ] **Check the new settings** under Pricing, "Sign-in and devices". Defaults, from decisions O1–O3:
  - 10 wrong PINs before a hard lock.
  - 5 trusted phones, forgotten after 180 days unused.
  - Sign out after 30 days unused.
  - A 7-day sending pause after a number change.
- [ ] **Smoke test on a real phone:**
  - Sign in by SMS, enter the PIN, and confirm the phone appears under Security → Trusted phones and the new-phone push arrives.
  - Change the PIN and confirm other phones are signed out.
  - Turn on Face ID, pay with it, and confirm the Keychain no longer holds the PIN. The old item is gone after the first Face ID use.

## 3. Firebase Authentication (B8)

- [ ] **SMS region policy (O4: Somalia and the UK only).** Authentication → Settings → SMS region policy → **Allow only**:
  - `SO` (+252, Somalia and Somaliland).
  - `GB` (+44): the apps already offer it at sign-in.
  - Nothing else (decided 2026-10-18). Every other country is blocked, so SMS pumping can't bill you from anywhere else. To serve another country later, add it here and to the sign-in screens' country list.

  The sign-in screens offer +252 and +44 (UK), so keep `GB` in the list. Whatever the apps offer, this policy is what stops someone calling the Auth API directly. Number changes (`startPhoneChange`) accept any international number, so the region policy is also what limits those.
- [ ] **App Check for Authentication.** App Check → APIs → Authentication → Monitor for a few days, then **Enforce**. Every callable already enforces App Check; this extends it to the SMS sending itself.
- [ ] **SMS abuse protection.** If the project is on Identity Platform, turn on the SMS toll-fraud protection (reCAPTCHA SMS defense) at a moderate threshold.
- [ ] **Remove unused providers.** Authentication → Sign-in method: only Phone (and Custom, used by PIN sign-in) should be on.

## 4. Spend and quota alerts (B8)

- [ ] **Billing budget** on the project with alerts at 50%, 90% and 100% of a monthly amount you expect. SMS costs show up here first.
- [ ] **SMS volume alert.** Cloud Monitoring → Alerting → a policy on Identity Toolkit verification SMS sent (or "Phone auth sent"), alerting on a spike over the daily norm, for example 3× the 7-day average.
- [ ] **Look at the Authentication usage page weekly** for sign-ins from countries you don't serve.

## 5. Ongoing

- [ ] When the terms or privacy policy change, raise the version in `functions/src/config/legal.ts` and both apps' `src/utils/legal.ts` together. Everyone is asked to accept again.
- [ ] Review flagged devices. In the console, a user's view shows "Device check". Reports with a root, jailbreak or hooking finding are collected in `deviceRiskReports`. It's a signal for investigations, not grounds to block on its own.
- [ ] Support's **Clear lockouts** now also opens a hard-locked PIN. Do it only after confirming identity in person or against the ID.

## What isn't covered yet

- **SMS alerts** for a new phone or a number change. Today these are push only, because the project has no SMS provider of its own.
- **Biometrics in the merchant app.** It needs `react-native-biometrics` and a new build. The merchant app has the PIN app lock.
- **A hard server-side block on unapproved Auth phone changes.** A signed-in client can attach a new number in Firebase Auth by itself. That changes only how it signs in, not the number the account is known and paid by, which moves only through `completePhoneChange`. Closing it fully needs Identity Platform blocking functions.

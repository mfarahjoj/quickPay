/**
 * Firebase wiring for the admin console.
 *
 * Config comes from environment variables rather than a committed file: the
 * values are not secret (they ship in the bundle) but they are per-project,
 * and a placeholder that looks real is worse than an explicit failure.
 */

import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getFunctions } from "firebase/functions";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const configError = !config.apiKey || !config.projectId
  ? "Firebase config missing. Copy admin/.env.example to admin/.env.local and fill it in."
  : null;

const app = initializeApp({
  ...config,
  // initializeApp rejects undefined; the banner above explains the real problem.
  apiKey: config.apiKey ?? "missing",
  projectId: config.projectId ?? "missing",
});

// App Check: the admin callables run with enforceAppCheck, so without this
// every request comes back unauthorised.
const siteKey = import.meta.env.VITE_APPCHECK_SITE_KEY;
if (import.meta.env.VITE_APPCHECK_DEBUG === "true") {
  // Vite only exposes VITE_* to the bundle; this global is read by the SDK.
  (window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
if (siteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.error("App Check init failed:", err);
  }
}

export const auth = getAuth(app);
export const functions = getFunctions(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(auth);
}

export interface AdminClaims {
  admin: boolean;
  adminRoles: string[];
}

/**
 * Read admin authority from the ID token.
 *
 * `force` re-fetches the token, which is how a freshly granted role becomes
 * visible without the user signing out and back in.
 */
export async function readAdminClaims(
  user: User,
  force = false
): Promise<AdminClaims> {
  const token = await user.getIdTokenResult(force);
  const roles = token.claims.adminRoles;
  return {
    admin: token.claims.admin === true,
    adminRoles: Array.isArray(roles) ? (roles as string[]) : [],
  };
}

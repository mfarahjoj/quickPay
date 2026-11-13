/**
 * Firebase wiring for the counter display. No Auth: the tablet is never a
 * Firebase user (COUNTER_DISPLAY_PLAN.md 4.1). It proves itself to the display
 * callables with its displayId + secret, and reads one state doc by its key.
 */
import { initializeApp } from "firebase/app";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const configError =
  !config.apiKey || !config.projectId ? "Firebase config missing. Copy display/.env.example to display/.env.local." : null;

const app = initializeApp({
  ...config,
  apiKey: config.apiKey ?? "missing",
  projectId: config.projectId ?? "missing",
});

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === "true";
const siteKey = import.meta.env.VITE_APPCHECK_SITE_KEY;

if (import.meta.env.VITE_APPCHECK_DEBUG === "true") {
  (window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
if (usingEmulators) {
  // The Functions emulator decodes App Check tokens without verifying their
  // signature, so an unsigned one naming this web app stands in for reCAPTCHA.
  // The build refuses VITE_USE_EMULATORS, so this never ships.
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => {
        const now = Math.floor(Date.now() / 1000);
        const claims = {
          sub: config.appId,
          app_id: config.appId,
          aud: [`projects/${config.projectId}`],
          iss: "https://firebaseappcheck.googleapis.com/0",
          iat: now,
          exp: now + 3600,
        };
        return { token: `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`, expireTimeMillis: (now + 3600) * 1000 };
      },
    }),
    isTokenAutoRefreshEnabled: true,
  });
} else if (siteKey) {
  try {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
  } catch (err) {
    console.error("App Check init failed:", err);
  }
}

// Long polling copes better with flaky shop Wi-Fi and captive proxies.
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
export const functions = getFunctions(app);

if (usingEmulators) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

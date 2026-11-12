import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Firebase config is read through `import.meta.env`, which Vite inlines at
 * BUILD time. That has a sharp edge: with the variables absent, the
 * `configError` constant in src/firebase.ts folds to a truthy literal, the
 * early return in <App> becomes unconditional, and Rollup then eliminates the
 * entire console as unreachable. The build still succeeds and still emits a
 * plausible-looking bundle — one that can only ever render "Not configured".
 *
 * So a missing config is a build failure, not a warning. Set
 * ALLOW_UNCONFIGURED_BUILD=1 if you deliberately want the stub (CI smoke test).
 *
 * The App Check site key is required for the same reason. Every admin
 * callable runs with enforceAppCheck, so a build without the key signs in and
 * then has every action refused. That used to be a warning, and a keyless
 * console went to production twice. Set ALLOW_NO_APPCHECK=1 to build one on
 * purpose (a local preview that never calls the backend).
 */
const REQUIRED = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID"];

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  if (command === "build" && process.env.ALLOW_UNCONFIGURED_BUILD !== "1") {
    const missing = REQUIRED.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Refusing to build the admin console without ${missing.join(", ")}.\n` +
          "Vite inlines these at build time; without them the whole app is " +
          "dead-code-eliminated and the deployed console can only show " +
          '"Not configured".\n' +
          "Copy admin/.env.example to admin/.env.local and fill it in, or set " +
          "ALLOW_UNCONFIGURED_BUILD=1 to build the stub on purpose."
      );
    }
    if (!env.VITE_APPCHECK_SITE_KEY && process.env.ALLOW_NO_APPCHECK !== "1") {
      throw new Error(
        "Refusing to build the admin console without VITE_APPCHECK_SITE_KEY.\n" +
          "The admin callables run with enforceAppCheck, so every request from " +
          "this build would be rejected.\n" +
          "Register a reCAPTCHA Enterprise key for the admin web app under " +
          "Firebase console -> App Check and put it in admin/.env.local, or set " +
          "ALLOW_NO_APPCHECK=1 to build a keyless preview on purpose."
      );
    }
  }

  return {
    plugins: [react()],
    build: {
      outDir: "dist",
      sourcemap: false,
    },
    server: {
      port: 5174,
    },
  };
});

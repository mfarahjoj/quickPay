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
    if (!env.VITE_APPCHECK_SITE_KEY) {
      console.warn(
        "\n[zapp-admin] VITE_APPCHECK_SITE_KEY is not set. The admin callables " +
          "run with enforceAppCheck, so every request from this build will be " +
          "rejected.\n"
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

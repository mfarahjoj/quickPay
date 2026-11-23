/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Same build-time refusals as admin/vite.config.ts, for the same reason:
 * Vite inlines the Firebase config, so a build without it is a site that can
 * only ever say "Not configured". Every display callable enforces App Check,
 * so a build without the site key pairs nothing.
 *
 * ALLOW_UNCONFIGURED_BUILD=1 / ALLOW_NO_APPCHECK=1 build those on purpose.
 */
const REQUIRED = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"];

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  if (command === "build" && process.env.ALLOW_UNCONFIGURED_BUILD !== "1") {
    const missing = REQUIRED.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(
        `Refusing to build the counter display without ${missing.join(", ")}.\n` +
          "Copy display/.env.example to display/.env.local and fill it in, or set " +
          "ALLOW_UNCONFIGURED_BUILD=1 to build the stub on purpose."
      );
    }
    if (env.VITE_USE_EMULATORS === "true") {
      throw new Error("Refusing to build with VITE_USE_EMULATORS=true: the site would talk to localhost.");
    }
    if (env.VITE_APPCHECK_DEBUG === "true") {
      throw new Error("Refusing to build with VITE_APPCHECK_DEBUG=true: never ship an App Check debug build.");
    }
    if (!env.VITE_APPCHECK_SITE_KEY && process.env.ALLOW_NO_APPCHECK !== "1") {
      throw new Error(
        "Refusing to build the counter display without VITE_APPCHECK_SITE_KEY.\n" +
          "Every display callable runs with enforceAppCheck, so this build could not pair.\n" +
          "Register a reCAPTCHA Enterprise key for the display web app under " +
          "Firebase console -> App Check, or set ALLOW_NO_APPCHECK=1 on purpose."
      );
    }
  }

  // A build id the heartbeat compares with config/app_client.display.latestBuild.
  const build = process.env.DISPLAY_BUILD || new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

  return {
    plugins: [react()],
    define: { __DISPLAY_BUILD__: JSON.stringify(build) },
    build: { outDir: "dist", sourcemap: false },
    server: { port: 5175 },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
});

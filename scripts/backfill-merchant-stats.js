#!/usr/bin/env node
/**
 * Start, watch or stop the merchant insights backfill (MERCHANT_INSIGHTS.md).
 *
 * The backfill itself runs on the server, inside merchantStatsNightly: while
 * `config/merchantStats.backfill.active` is true, each run walks a few
 * minutes of `transactions` history, oldest first, through the same
 * applyStoreEvent the live trigger uses, and saves a cursor. Every row is
 * counted once, whichever of the trigger, the catch-up or the backfill gets
 * to it first, so starting it while shops are trading is safe.
 *
 * Deploy merchantStatsOnTransaction and merchantStatsNightly first: the
 * trigger must be live before the backfill reaches the present, or rows in
 * between are left to the nightly catch-up of their day only.
 *
 * Usage:
 *   node scripts/backfill-merchant-stats.js --status
 *   node scripts/backfill-merchant-stats.js --start
 *   node scripts/backfill-merchant-stats.js --stop
 *
 * Then, rather than wait for 03:30, run the job now (repeat until --status
 * says finished):
 *   gcloud scheduler jobs run firebase-schedule-merchantStatsNightly-us-central1 \
 *     --location=us-central1 --project=quickpay-485417
 *
 * Auth: Firebase CLI login -> OAuth token -> Firestore REST (as in
 * backfill-transaction-kinds.js).
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const PROJECT_ID = "quickpay-485417";
const DOC = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/config/merchantStats`;

async function getAccessToken() {
  const cfgPath = path.join(os.homedir(), ".config/configstore/firebase-tools.json");
  if (!fs.existsSync(cfgPath)) throw new Error("No Firebase CLI login found. Run `firebase login`.");
  const tokens = JSON.parse(fs.readFileSync(cfgPath, "utf8")).tokens;
  if (!tokens?.refresh_token) throw new Error("No refresh token in Firebase CLI config. Run `firebase login`.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      // Public OAuth client baked into firebase-tools
      client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
      client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

function readValue(v) {
  if (!v) return undefined;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("mapValue" in v) {
    const out = {};
    for (const [k, f] of Object.entries(v.mapValue.fields ?? {})) out[k] = readValue(f);
    return out;
  }
  return undefined;
}

async function main() {
  const mode = process.argv[2];
  if (!["--status", "--start", "--stop"].includes(mode)) {
    console.log("Usage: node scripts/backfill-merchant-stats.js --status | --start | --stop");
    process.exitCode = 1;
    return;
  }
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  if (mode === "--start" || mode === "--stop") {
    const fields =
      mode === "--start"
        ? { active: { booleanValue: true }, cursorMs: { integerValue: "0" }, scanned: { integerValue: "0" }, applied: { integerValue: "0" }, startedAtMs: { integerValue: String(Date.now()) } }
        : { active: { booleanValue: false } };
    // A field named in the mask but absent from the body is deleted: a fresh
    // start clears the previous run's finish time.
    const masked = mode === "--start" ? [...Object.keys(fields), "finishedAtMs"] : Object.keys(fields);
    const mask = masked.map((k) => `updateMask.fieldPaths=backfill.${k}`).join("&");
    const res = await fetch(`${DOC}?${mask}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields: { backfill: { mapValue: { fields } } } }),
    });
    if (!res.ok) throw new Error(`Write failed: ${res.status} ${await res.text()}`);
    console.log(mode === "--start" ? "Backfill switched on from the beginning of history." : "Backfill switched off.");
  }

  const res = await fetch(DOC, { headers });
  if (res.status === 404) {
    console.log("No config/merchantStats yet: the backfill has never run.");
    return;
  }
  if (!res.ok) throw new Error(`Read failed: ${res.status} ${await res.text()}`);
  const b = readValue({ mapValue: { fields: (await res.json()).fields ?? {} } }).backfill ?? {};
  const at = (ms) => (ms ? new Date(ms).toISOString() : "—");
  console.log(`active:    ${b.active === true}`);
  console.log(`cursor:    ${at(b.cursorMs)}`);
  console.log(`rows read: ${b.scanned ?? 0}, applied: ${b.applied ?? 0}`);
  console.log(`started:   ${at(b.startedAtMs)}   finished: ${at(b.finishedAtMs)}`);
  if (b.active) {
    console.log("\nRun the job now instead of waiting for 03:30:");
    console.log(`  gcloud scheduler jobs run firebase-schedule-merchantStatsNightly-us-central1 --location=us-central1 --project=${PROJECT_ID}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});

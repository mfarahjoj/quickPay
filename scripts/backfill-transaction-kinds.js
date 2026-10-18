#!/usr/bin/env node
/**
 * One-off (plan 3.1): give every stored transaction row a `kind`.
 *
 * Writers set `kind` since commit "Tag every transaction with what it is".
 * Older rows are tagged with the same rule the backend applies at read time
 * (functions/src/utils/transactionKind.ts: the journal entry id prefix), so
 * stored and derived kinds can never disagree. Only `kind` is written; a row
 * that already has one is left alone.
 *
 * Safety:
 *   - Dry run by default: prints counts per kind and a few examples.
 *   - With --apply, each row is a PATCH with updateMask=kind and a
 *     precondition that `kind` does not exist yet, so a rerun is a no-op and
 *     no other field can change.
 *
 * Usage (build the functions first, the rule is read from functions/lib):
 *   (cd functions && npm run build)
 *   node scripts/backfill-transaction-kinds.js            # dry run
 *   node scripts/backfill-transaction-kinds.js --apply    # write
 *
 * Auth: Firebase CLI login -> OAuth token -> Firestore REST (as in
 * tidy-test-wallets.js).
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const { kindOf } = require(path.join(__dirname, "../functions/lib/utils/transactionKind.js"));

const PROJECT_ID = "quickpay-485417";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const PAGE = 300;

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

const str = (f) => (f && "stringValue" in f ? f.stringValue : undefined);

async function main() {
  const apply = process.argv.includes("--apply");
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}`);

  const counts = {};
  const examples = {};
  let scanned = 0;
  let alreadyTagged = 0;
  let written = 0;
  const failures = [];
  let pageToken = "";

  do {
    const mask = ["type", "journalEntryId", "apiChargeId", "kind"].map((f) => `mask.fieldPaths=${f}`).join("&");
    const url = `${BASE}/transactions?pageSize=${PAGE}&${mask}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`);
    const body = await res.json();

    for (const doc of body.documents ?? []) {
      scanned++;
      const f = doc.fields ?? {};
      if (str(f.kind)) {
        alreadyTagged++;
        continue;
      }
      const kind = kindOf({ type: str(f.type), journalEntryId: str(f.journalEntryId), apiChargeId: str(f.apiChargeId) });
      counts[kind] = (counts[kind] ?? 0) + 1;
      (examples[kind] ??= []).length < 3 && examples[kind].push(`${doc.name.split("/").pop()} (${str(f.type)}, ${str(f.journalEntryId) ?? "no entry"})`);

      if (apply) {
        const patch = await fetch(
          `https://firestore.googleapis.com/v1/${doc.name}?updateMask.fieldPaths=kind&currentDocument.exists=true`,
          { method: "PATCH", headers, body: JSON.stringify({ fields: { kind: { stringValue: kind } } }) }
        );
        if (patch.ok) written++;
        else failures.push(`${doc.name.split("/").pop()}: HTTP ${patch.status}`);
      }
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);

  console.log(`Scanned ${scanned} rows; ${alreadyTagged} already had a kind.`);
  for (const [kind, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(22)} ${n}   e.g. ${examples[kind].join("; ")}`);
  }
  if (apply) console.log(`Wrote kind on ${written} rows.`);
  if (failures.length) {
    console.log(`\n${failures.length} failed:`);
    failures.forEach((f) => console.log(`  ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

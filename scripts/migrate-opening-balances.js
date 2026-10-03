#!/usr/bin/env node
/**
 * One-time ledger migration: post an `opening_balance` journal entry for every
 * wallet with a nonzero balance, so the journal explains 100% of every balance
 * from day one (see LEDGER_ARCHITECTURE.md §4.2).
 *
 * Existing wallet docs already hold correct balances, so this script writes the
 * journal entries and the `ledger_balances` projections for float/platform
 * accounts WITHOUT touching wallet docs. Idempotent: entry IDs are
 * deterministic (`opening_{uid}`), creates fail on existing docs, and
 * already-posted entries are skipped.
 *
 * Usage:
 *   node scripts/migrate-opening-balances.js          # dry run (default)
 *   node scripts/migrate-opening-balances.js --apply  # write for real
 *
 * Auth: exchanges your Firebase CLI login (~/.config/configstore/firebase-tools.json)
 * for an OAuth access token and talks to the Firestore REST API directly —
 * the admin SDK refuses refresh-token credentials for Firestore.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const PROJECT_ID = "quickpay-485417";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const PLATFORM_WALLET_DOC = "platform";

const FLOAT_AGENTS = "float:agents";
const PLATFORM_FEES = "platform:fees";

async function getAccessToken() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS is set — use the admin SDK variant instead, or unset it."
    );
  }
  const cfgPath = path.join(os.homedir(), ".config/configstore/firebase-tools.json");
  if (!fs.existsSync(cfgPath)) {
    throw new Error("No Firebase CLI login found. Run `firebase login` first.");
  }
  const tokens = JSON.parse(fs.readFileSync(cfgPath, "utf8")).tokens;
  if (!tokens || !tokens.refresh_token) {
    throw new Error("No refresh token in Firebase CLI config. Run `firebase login`.");
  }
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

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Convert a plain JS value to a Firestore REST typed value. */
function toValue(v) {
  if (typeof v === "number" && Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (v && typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toValue(val);
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported value: ${v}`);
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toValue(v);
  return fields;
}

/** Lines for one opening entry: value appears in the wallet, backed by agent float. */
function openingLines(account, cents) {
  if (cents > 0) {
    return [
      { account: FLOAT_AGENTS, debit: cents, credit: 0 },
      { account, debit: 0, credit: cents },
    ];
  }
  // Negative balance (shouldn't exist for users; platform promo deficit can).
  return [
    { account, debit: -cents, credit: 0 },
    { account: FLOAT_AGENTS, debit: 0, credit: -cents },
  ];
}

async function listWallets(token) {
  const wallets = [];
  let pageToken;
  do {
    const url = `${BASE}/wallets?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const { status, json } = await api(token, "GET", url);
    if (status !== 200) throw new Error(`Listing wallets failed: ${status} ${JSON.stringify(json)}`);
    for (const doc of json.documents ?? []) {
      const id = doc.name.split("/").pop();
      const balanceField = doc.fields?.balance;
      if (balanceField && balanceField.integerValue === undefined && balanceField.doubleValue === undefined) {
        throw new Error(`wallets/${id} balance has unexpected type: ${JSON.stringify(balanceField)}`);
      }
      const balance = balanceField
        ? parseInt(balanceField.integerValue ?? balanceField.doubleValue ?? "0", 10)
        : 0;
      wallets.push({ id, balance });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return wallets;
}

async function entryExists(token, entryId) {
  const { status } = await api(token, "GET", `${BASE}/journal_entries/${entryId}`);
  if (status === 200) return true;
  if (status === 404) return false;
  throw new Error(`Checking ${entryId} failed with HTTP ${status}`);
}

async function createEntry(token, entryId, entryDoc) {
  // createDocument fails with 409 if the document already exists.
  const { status, json } = await api(
    token,
    "POST",
    `${BASE}/journal_entries?documentId=${entryId}`,
    { fields: toFields(entryDoc) }
  );
  if (status === 409) return "exists";
  if (status !== 200) throw new Error(`Creating ${entryId} failed: ${status} ${JSON.stringify(json)}`);
  return "created";
}

async function incrementLedgerBalance(token, account, delta, nowIso) {
  const docPath = `projects/${PROJECT_ID}/databases/(default)/documents/ledger_balances/${account}`;
  const { status, json } = await api(
    token,
    "POST",
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    {
      writes: [
        {
          update: {
            name: docPath,
            fields: toFields({ account, currency: "USD", updatedAt: new Date(nowIso) }),
          },
          updateMask: { fieldPaths: ["account", "currency", "updatedAt"] },
        },
        {
          transform: {
            document: docPath,
            fieldTransforms: [
              { fieldPath: "balance", increment: { integerValue: String(delta) } },
            ],
          },
        },
      ],
    }
  );
  if (status !== 200)
    throw new Error(`Incrementing ${account} failed: ${status} ${JSON.stringify(json)}`);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = await getAccessToken();

  const wallets = await listWallets(token);
  console.log(`${wallets.length} wallet docs found. Mode: ${apply ? "APPLY" : "dry run"}\n`);

  let floatAgentsDelta = 0; // credit-positive, so holding value goes negative
  let posted = 0;
  let skipped = 0;
  const nowIso = new Date().toISOString();

  for (const { id, balance } of wallets) {
    if (!Number.isInteger(balance)) {
      console.error(`  !! wallets/${id} has non-integer balance ${balance} — fix first`);
      process.exit(1);
    }
    if (balance === 0) {
      if (!apply) console.log(`  wallets/${id}: 0.00 USD — nothing to post`);
      continue;
    }

    const isPlatform = id === PLATFORM_WALLET_DOC;
    const account = isPlatform ? PLATFORM_FEES : `user:${id}`;
    const entryId = isPlatform ? "opening_platform" : `opening_${id}`;

    if (await entryExists(token, entryId)) {
      console.log(`  skip ${entryId} (already posted)`);
      skipped++;
      continue;
    }

    const lines = openingLines(account, balance);
    console.log(`  ${entryId}: ${account} ${(balance / 100).toFixed(2)} USD`);

    if (apply) {
      const result = await createEntry(token, entryId, {
        type: "opening_balance",
        currency: "USD",
        lines,
        refs: {},
        description: "Ledger migration: opening balance from pre-ledger wallet",
        postedBy: "system",
        postedAt: new Date(nowIso),
      });
      if (result === "exists") {
        console.log(`  race: ${entryId} appeared mid-run — skipping projections for it`);
        skipped++;
        continue;
      }
      if (isPlatform) {
        await incrementLedgerBalance(token, PLATFORM_FEES, balance, nowIso);
      }
    }
    floatAgentsDelta -= balance;
    posted++;
  }

  if (apply && floatAgentsDelta !== 0) {
    await incrementLedgerBalance(token, FLOAT_AGENTS, floatAgentsDelta, nowIso);
  }

  console.log(`\n${posted} entries ${apply ? "posted" : "would be posted"}, ${skipped} skipped.`);
  console.log(
    `float:agents projection ${apply ? "adjusted" : "would adjust"} by ${(floatAgentsDelta / 100).toFixed(2)} USD (credit-positive).`
  );
  if (!apply) console.log("\nRe-run with --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

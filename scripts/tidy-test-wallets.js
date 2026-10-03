#!/usr/bin/env node
/**
 * One-off: explain the seven pre-ledger test balances flagged by the nightly
 * ledger invariant check ("Wallet has a balance with no journal entries
 * explaining it").
 *
 * These wallets were given a starting balance at signup, before the ledger
 * existed, and have never transacted. The money is test money, so rather than
 * touching any wallet we post one `opening_balance` entry per wallet:
 *
 *     platform:promo  debit  N      (promo spend, shows as a promo deficit)
 *     user:{uid}      credit N
 *
 * Wallets are NOT modified; the journal catches up with them. Entry ids are
 * `opening_{uid}`, the same ids scripts/migrate-opening-balances.js uses, so
 * neither script can post the same wallet twice.
 *
 * Safety:
 *   - Locked to the wallets below, with exact amounts. A wallet whose balance
 *     no longer matches is skipped and reported, never "fixed".
 *   - Dry run by default. Nothing is written without --apply.
 *   - Each entry and its platform:promo projection update are ONE atomic
 *     Firestore commit, and the entry is created with exists:false, so a rerun
 *     is a no-op.
 *
 * Usage:
 *   node scripts/tidy-test-wallets.js            # dry run
 *   node scripts/tidy-test-wallets.js --apply    # write
 *
 * Afterwards: console -> Ledger -> "Run check now" should report zero drift.
 *
 * Auth: Firebase CLI login -> OAuth token -> Firestore REST (as in
 * migrate-opening-balances.js).
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const PROJECT_ID = "quickpay-485417";
const DB = `projects/${PROJECT_ID}/databases/(default)`;
const BASE = `https://firestore.googleapis.com/v1/${DB}/documents`;
const OFFSET_ACCOUNT = "platform:promo";

/** uid -> cents, from the 2026-10-02 drift investigation. */
const WALLETS = {
  "6J32hi4UhrgY6hqFJ1UhTXsUu9H2": 10,
  Dn3ZKh8wrTc7ir6mtiQ7WJeZ6md2: 10,
  IgssWkdkRhTbRTHZe5aSrdgprL02: 10,
  QawBKSdKJigyS8UxI1CmrSh7tx03: 10,
  S8w9qdOKk9bth9Yb6Y4LhTV7toI3: 10,
  SSnM4W9PQtV8wptcWP2w4BoRaJ02: 10,
  TkuSUa91b3SDrPMTsbONEOBfQ7F3: 10000, // founder's test agent account
};

const usd = (c) => `$${(c / 100).toFixed(2)}`;

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

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

function toValue(v) {
  if (typeof v === "number" && Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (v && typeof v === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
  }
  throw new Error(`Unsupported value: ${v}`);
}
const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));
const num = (f) => (f ? Number(f.integerValue ?? f.doubleValue ?? 0) : 0);

/** Pure, so it can be checked without touching Firestore. */
function entryLines(uid, cents) {
  return [
    { account: OFFSET_ACCOUNT, debit: cents, credit: 0 },
    { account: `user:${uid}`, debit: 0, credit: cents },
  ];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = await getAccessToken();
  // The document id IS the account string ("platform:promo"), colon included.
  // Percent-encoding it would create a different document the backend never reads.
  const promoDoc = `ledger_balances/${OFFSET_ACCOUNT}`;
  const promoPath = `${DB}/documents/${promoDoc}`;

  const promoBefore = await api(token, "GET", `${BASE}/${promoDoc}`);
  const promoNow = promoBefore.status === 200 ? num(promoBefore.json.fields?.balance) : 0;
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}`);
  console.log(`${OFFSET_ACCOUNT} projection now: ${usd(promoNow)}\n`);

  let posted = 0;
  let total = 0;
  const problems = [];

  for (const [uid, cents] of Object.entries(WALLETS)) {
    const entryId = `opening_${uid}`;
    const wallet = await api(token, "GET", `${BASE}/wallets/${uid}`);
    if (wallet.status !== 200) {
      problems.push(`${uid}: wallet doc not found (HTTP ${wallet.status})`);
      continue;
    }
    const balance = num(wallet.json.fields?.balance);
    if (balance !== cents) {
      problems.push(`${uid}: wallet holds ${usd(balance)}, expected ${usd(cents)}. Skipped, investigate first.`);
      continue;
    }
    const existing = await api(token, "GET", `${BASE}/journal_entries/${entryId}`);
    if (existing.status === 200) {
      console.log(`  skip ${entryId}: already posted`);
      continue;
    }
    if (existing.status !== 404) throw new Error(`Checking ${entryId} failed: HTTP ${existing.status}`);

    console.log(`  ${entryId}: ${OFFSET_ACCOUNT} -> user:${uid}  ${usd(cents)}`);
    if (apply) {
      const now = new Date();
      const entryPath = `${DB}/documents/journal_entries/${entryId}`;
      const { status, json } = await api(token, "POST", `https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
        writes: [
          {
            update: {
              name: entryPath,
              fields: toFields({
                type: "opening_balance",
                currency: "USD",
                lines: entryLines(uid, cents),
                refs: {},
                description: "Test balance written at signup before the ledger existed; funded from platform:promo (testing phase)",
                postedBy: "system",
                postedAt: now,
              }),
            },
            currentDocument: { exists: false },
          },
          {
            update: { name: promoPath, fields: toFields({ account: OFFSET_ACCOUNT, currency: "USD", updatedAt: now }) },
            updateMask: { fieldPaths: ["account", "currency", "updatedAt"] },
          },
          {
            transform: {
              document: promoPath,
              fieldTransforms: [{ fieldPath: "balance", increment: { integerValue: String(-cents) } }],
            },
          },
        ],
      });
      if (status !== 200) throw new Error(`Posting ${entryId} failed: ${status} ${JSON.stringify(json)}`);
    }
    posted++;
    total += cents;
  }

  console.log(`\n${posted} entries ${apply ? "posted" : "would be posted"}, ${usd(total)} total.`);
  console.log(`${OFFSET_ACCOUNT} ${apply ? "is now" : "would become"} ${usd(promoNow - total)} (a promo deficit: expected).`);
  if (problems.length) {
    console.log("\nNeeds attention:");
    for (const p of problems) console.log("  - " + p);
  }
  if (!apply) console.log("\nRe-run with --apply to write.");
  else console.log('\nNext: console -> Ledger -> "Run check now". It should report zero drift.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { entryLines, WALLETS };

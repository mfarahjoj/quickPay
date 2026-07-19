#!/usr/bin/env node
/**
 * One-time ledger migration: post an `opening_balance` journal entry for every
 * wallet with a nonzero balance, so the journal explains 100% of every balance
 * from day one (see LEDGER_ARCHITECTURE.md §4.2).
 *
 * Existing wallet docs already hold correct balances, so this script writes the
 * journal entries and the `ledger_balances` projections for float/platform
 * accounts WITHOUT touching wallet docs. Idempotent: entry IDs are
 * deterministic (`opening_{uid}`) and already-posted entries are skipped.
 *
 * Usage:
 *   node scripts/migrate-opening-balances.js          # dry run (default)
 *   node scripts/migrate-opening-balances.js --apply  # write for real
 *
 * Auth: reuses your Firebase CLI login (~/.config/configstore/firebase-tools.json).
 * Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key to override.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

// firebase-admin lives in functions/node_modules
const admin = require(path.join(__dirname, "../functions/node_modules/firebase-admin"));

const PROJECT_ID = "quickpay-485417";
const PLATFORM_WALLET_DOC = "platform";

const FLOAT_AGENTS = "float:agents";
const PLATFORM_FEES = "platform:fees";

function credentialFromFirebaseCli() {
  const cfgPath = path.join(os.homedir(), ".config/configstore/firebase-tools.json");
  if (!fs.existsSync(cfgPath)) return null;
  const tokens = JSON.parse(fs.readFileSync(cfgPath, "utf8")).tokens;
  if (!tokens || !tokens.refresh_token) return null;
  return admin.credential.refreshToken({
    type: "authorized_user",
    // Public OAuth client baked into firebase-tools
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: tokens.refresh_token,
  });
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

async function main() {
  const apply = process.argv.includes("--apply");

  const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? admin.credential.applicationDefault()
    : credentialFromFirebaseCli();
  if (!credential) {
    console.error("No credentials. Run `firebase login` or set GOOGLE_APPLICATION_CREDENTIALS.");
    process.exit(1);
  }
  admin.initializeApp({ credential, projectId: PROJECT_ID });
  const db = admin.firestore();

  const wallets = await db.collection("wallets").get();
  console.log(`${wallets.size} wallet docs found. Mode: ${apply ? "APPLY" : "dry run"}\n`);

  let floatAgentsDelta = 0; // credit-positive, so holding value goes negative
  let posted = 0;
  let skipped = 0;

  for (const doc of wallets.docs) {
    const balance = doc.data().balance ?? 0;
    if (!Number.isInteger(balance)) {
      console.error(`  !! wallets/${doc.id} has non-integer balance ${balance} — fix first`);
      process.exit(1);
    }
    if (balance === 0) continue;

    const isPlatform = doc.id === PLATFORM_WALLET_DOC;
    const account = isPlatform ? PLATFORM_FEES : `user:${doc.id}`;
    const entryId = isPlatform ? "opening_platform" : `opening_${doc.id}`;
    const entryRef = db.collection("journal_entries").doc(entryId);

    if ((await entryRef.get()).exists) {
      console.log(`  skip ${entryId} (already posted)`);
      skipped++;
      continue;
    }

    const lines = openingLines(account, balance);
    console.log(`  ${entryId}: ${account} ${(balance / 100).toFixed(2)} USD`);

    if (apply) {
      const now = admin.firestore.Timestamp.now();
      await entryRef.create({
        type: "opening_balance",
        currency: "USD",
        lines,
        refs: {},
        description: "Ledger migration: opening balance from pre-ledger wallet",
        postedBy: "system",
        postedAt: now,
      });
      if (isPlatform) {
        await db.collection("ledger_balances").doc(PLATFORM_FEES).set(
          {
            account: PLATFORM_FEES,
            balance: admin.firestore.FieldValue.increment(balance),
            currency: "USD",
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }
    floatAgentsDelta -= balance;
    posted++;
  }

  if (apply && floatAgentsDelta !== 0) {
    await db.collection("ledger_balances").doc(FLOAT_AGENTS).set(
      {
        account: FLOAT_AGENTS,
        balance: admin.firestore.FieldValue.increment(floatAgentsDelta),
        currency: "USD",
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );
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

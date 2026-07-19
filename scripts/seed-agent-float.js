#!/usr/bin/env node
/**
 * Seed float into an agent's wallet for testing the float-funded top-up model.
 *
 * Usage:
 *   node scripts/seed-agent-float.js <phone(+252…) | uid> <amountUSD>
 *   node scripts/seed-agent-float.js +252634445566 500
 *
 * Credits the wallet and writes a matching `transactions` ledger record from
 * the platform account, so the seeded float shows up in transaction history.
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
const PLATFORM_ACCOUNT_ID = "platform";

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

async function main() {
  const [target, amountArg] = process.argv.slice(2);
  const amountDollars = parseFloat(amountArg);
  if (!target || !Number.isFinite(amountDollars) || amountDollars <= 0) {
    console.error("Usage: node scripts/seed-agent-float.js <phone|uid> <amountUSD>");
    process.exit(1);
  }
  const amountCents = Math.round(amountDollars * 100);

  const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? admin.credential.applicationDefault()
    : credentialFromFirebaseCli();
  if (!credential) {
    console.error("No credentials. Run `firebase login` or set GOOGLE_APPLICATION_CREDENTIALS.");
    process.exit(1);
  }
  admin.initializeApp({ credential, projectId: PROJECT_ID });
  const db = admin.firestore();

  // Resolve uid from phone number if needed
  let uid = target;
  if (target.startsWith("+")) {
    const snap = await db.collection("users").where("phoneNumber", "==", target).limit(1).get();
    if (snap.empty) {
      console.error(`No user found with phone ${target}`);
      process.exit(1);
    }
    uid = snap.docs[0].id;
  }

  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) {
    console.error(`No user doc for uid ${uid}`);
    process.exit(1);
  }
  const user = userDoc.data();
  console.log(`Seeding float for: ${user.fullName} (${user.phoneNumber}) — ${user.accountType}`);

  const now = admin.firestore.Timestamp.now();
  const txId = db.collection("transactions").doc().id;

  const newBalance = await db.runTransaction(async (tx) => {
    const walletRef = db.collection("wallets").doc(uid);
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists) {
      throw new Error(`Wallet not found for ${uid} — has the user finished signup?`);
    }
    const wallet = walletSnap.data();

    tx.update(walletRef, {
      balance: wallet.balance + amountCents,
      totalReceived: wallet.totalReceived + amountCents,
      lastTransactionAt: now,
      updatedAt: now,
    });

    tx.set(db.collection("transactions").doc(txId), {
      type: "topup",
      fromUserId: PLATFORM_ACCOUNT_ID,
      toUserId: uid,
      participants: [PLATFORM_ACCOUNT_ID, uid],
      amount: amountCents,
      currency: wallet.currency || "USD",
      status: "completed",
      description: "Agent float purchase (seeded)",
      reference: txId,
      createdAt: now,
      completedAt: now,
    });

    return wallet.balance + amountCents;
  });

  console.log(`✓ Credited $${amountDollars.toFixed(2)} float. New balance: $${(newBalance / 100).toFixed(2)}`);
  console.log(`  Ledger transaction: ${txId}`);
}

main().catch((err) => {
  console.error("Failed:", err.message || err);
  process.exit(1);
});

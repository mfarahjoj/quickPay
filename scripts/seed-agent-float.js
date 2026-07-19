#!/usr/bin/env node
/**
 * Seed float into an agent's wallet for testing the float-funded top-up model.
 *
 * Usage:
 *   node scripts/seed-agent-float.js <phone(+252…) | uid> <amountUSD>
 *   node scripts/seed-agent-float.js +252634445566 500
 *
 * Ledger-aware: posts a journal entry (debit float:agents, credit the agent's
 * wallet) and updates the wallet + ledger_balances projections atomically, so
 * the invariant check explains the seeded value. Also writes a `transactions`
 * record so the float shows up in the agent's history.
 *
 * Auth: exchanges your Firebase CLI login (~/.config/configstore/firebase-tools.json)
 * for an OAuth access token and talks to the Firestore REST API directly —
 * the admin SDK refuses refresh-token credentials for Firestore.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const PROJECT_ID = "quickpay-485417";
const DB = `projects/${PROJECT_ID}/databases/(default)`;
const BASE = `https://firestore.googleapis.com/v1/${DB}/documents`;

const FLOAT_AGENTS = "float:agents";

async function getAccessToken() {
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

async function findUserByPhone(token, phone) {
  const { status, json } = await api(token, "POST", `${BASE}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "phoneNumber" },
          op: "EQUAL",
          value: { stringValue: phone },
        },
      },
      limit: 1,
    },
  });
  if (status !== 200) throw new Error(`User query failed: ${status} ${JSON.stringify(json)}`);
  const hit = (json || []).find((r) => r.document);
  return hit ? hit.document : null;
}

async function getDoc(token, docPath) {
  const { status, json } = await api(token, "GET", `${BASE}/${docPath}`);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`Fetching ${docPath} failed: ${status}`);
  return json;
}

function str(doc, field) {
  return doc?.fields?.[field]?.stringValue;
}

async function main() {
  const [target, amountArg] = process.argv.slice(2);
  const amountDollars = parseFloat(amountArg);
  if (!target || !Number.isFinite(amountDollars) || amountDollars <= 0) {
    console.error("Usage: node scripts/seed-agent-float.js <phone|uid> <amountUSD>");
    process.exit(1);
  }
  const amountCents = Math.round(amountDollars * 100);

  const token = await getAccessToken();

  // Resolve uid from phone number if needed
  let uid = target;
  let userDoc;
  if (target.startsWith("+")) {
    userDoc = await findUserByPhone(token, target);
    if (!userDoc) {
      console.error(`No user found with phone ${target}`);
      process.exit(1);
    }
    uid = userDoc.name.split("/").pop();
  } else {
    userDoc = await getDoc(token, `users/${uid}`);
    if (!userDoc) {
      console.error(`No user doc for uid ${uid}`);
      process.exit(1);
    }
  }
  console.log(
    `Seeding float for: ${str(userDoc, "fullName")} (${str(userDoc, "phoneNumber")}) — ${str(userDoc, "accountType")}`
  );

  const walletDoc = await getDoc(token, `wallets/${uid}`);
  if (!walletDoc) {
    console.error(`No wallet doc for uid ${uid} — has the user finished signup?`);
    process.exit(1);
  }

  const now = new Date();
  const nonce = crypto.randomBytes(4).toString("hex");
  const entryId = `seedfloat_${uid.slice(0, 8)}_${nonce}`;
  const transactionId = `${entryId}_tx`;
  const account = `user:${uid}`;

  // One atomic commit: journal entry (create), wallet + float projections
  // (increments), and a transactions record for the agent's history.
  const { status, json } = await api(token, "POST", `${BASE}:commit`, {
    writes: [
      {
        update: {
          name: `${DB}/documents/journal_entries/${entryId}`,
          fields: toFields({
            type: "adjustment",
            currency: "USD",
            lines: [
              { account: FLOAT_AGENTS, debit: amountCents, credit: 0 },
              { account, debit: 0, credit: amountCents },
            ],
            refs: { transactionId },
            description: "Agent float purchase (seeded for testing)",
            postedBy: "system",
            postedAt: now,
          }),
        },
        currentDocument: { exists: false },
      },
      {
        transform: {
          document: `${DB}/documents/wallets/${uid}`,
          fieldTransforms: [
            { fieldPath: "balance", increment: { integerValue: String(amountCents) } },
            { fieldPath: "totalReceived", increment: { integerValue: String(amountCents) } },
          ],
        },
      },
      {
        update: {
          name: `${DB}/documents/wallets/${uid}`,
          fields: toFields({ updatedAt: now, lastTransactionAt: now }),
        },
        updateMask: { fieldPaths: ["updatedAt", "lastTransactionAt"] },
      },
      {
        update: {
          name: `${DB}/documents/ledger_balances/${FLOAT_AGENTS}`,
          fields: toFields({ account: FLOAT_AGENTS, currency: "USD", updatedAt: now }),
        },
        updateMask: { fieldPaths: ["account", "currency", "updatedAt"] },
      },
      {
        transform: {
          document: `${DB}/documents/ledger_balances/${FLOAT_AGENTS}`,
          fieldTransforms: [
            { fieldPath: "balance", increment: { integerValue: String(-amountCents) } },
          ],
        },
      },
      {
        update: {
          name: `${DB}/documents/transactions/${transactionId}`,
          fields: toFields({
            type: "topup",
            fromUserId: "platform",
            toUserId: uid,
            participants: ["platform", uid],
            amount: amountCents,
            currency: "USD",
            status: "completed",
            description: "Float purchase",
            journalEntryId: entryId,
            createdAt: now,
            completedAt: now,
          }),
        },
        currentDocument: { exists: false },
      },
    ],
  });
  if (status !== 200) throw new Error(`Commit failed: ${status} ${JSON.stringify(json)}`);

  console.log(`\nSeeded $${amountDollars.toFixed(2)} float → ${uid}`);
  console.log(`Journal entry: ${entryId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

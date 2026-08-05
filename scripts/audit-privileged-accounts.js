#!/usr/bin/env node
/**
 * Audit accounts that hold a privileged role.
 *
 * Before the role approval gate (ADMIN_CONSOLE_PLAN.md §4.1) anyone could
 * self-select `merchant`, `topup_agent` or `agent_merchant` by passing it to
 * setupPin. This lists every account that did, with the context a reviewer
 * needs, and can file each one as a pending role request so they get reviewed
 * in the console like any new applicant.
 *
 * Usage:
 *   node scripts/audit-privileged-accounts.js              # report only
 *   node scripts/audit-privileged-accounts.js --backfill   # file pending requests
 *
 * --backfill does NOT change anyone's role. Existing agents keep working
 * until an admin decides; approving in the console keeps the role, rejecting
 * demotes to customer.
 *
 * Auth: exchanges your Firebase CLI login for an OAuth access token and uses
 * the Firestore REST API directly — the admin SDK refuses refresh-token
 * credentials for Firestore.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const PROJECT_ID = "quickpay-485417";
const DB = `projects/${PROJECT_ID}/databases/(default)`;
const BASE = `https://firestore.googleapis.com/v1/${DB}/documents`;

const PRIVILEGED = ["merchant", "topup_agent", "agent_merchant"];

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
  const json = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 404) {
    throw new Error(`${method} ${url} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return { status: res.status, json };
}

function str(doc, field) {
  return doc?.fields?.[field]?.stringValue;
}

function int(doc, field) {
  const v = doc?.fields?.[field]?.integerValue;
  return v === undefined ? undefined : Number(v);
}

async function queryPrivilegedUsers(token) {
  const { json } = await api(token, "POST", `${BASE}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "accountType" },
          op: "IN",
          value: {
            arrayValue: { values: PRIVILEGED.map((r) => ({ stringValue: r })) },
          },
        },
      },
    },
  });
  return (json || []).filter((r) => r.document).map((r) => r.document);
}

async function getWalletBalance(token, uid) {
  const { status, json } = await api(token, "GET", `${BASE}/wallets/${uid}`);
  if (status === 404) return null;
  return int(json, "balance") ?? 0;
}

async function countTransactions(token, uid) {
  const { json } = await api(token, "POST", `${BASE}:runAggregationQuery`, {
    structuredAggregationQuery: {
      structuredQuery: {
        from: [{ collectionId: "transactions" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "participants" },
            op: "ARRAY_CONTAINS",
            value: { stringValue: uid },
          },
        },
      },
      aggregations: [{ count: {}, alias: "total" }],
    },
  });
  const result = (json || []).find((r) => r.result);
  return Number(result?.result?.aggregateFields?.total?.integerValue ?? 0);
}

async function fileRoleRequest(token, uid, role, businessName) {
  const docId = `${uid}_${role}`;
  const { status } = await api(token, "GET", `${BASE}/roleRequests/${docId}`);
  if (status !== 404) {
    return "exists";
  }

  const fields = {
    userId: { stringValue: uid },
    requestedRole: { stringValue: role },
    status: { stringValue: "pending" },
    backfilled: { booleanValue: true },
    createdAt: { timestampValue: new Date().toISOString() },
  };
  if (businessName) fields.businessName = { stringValue: businessName };

  await api(
    token,
    "PATCH",
    `${BASE}/roleRequests/${docId}?currentDocument.exists=false`,
    { fields }
  );
  return "created";
}

function money(cents) {
  if (cents === null || cents === undefined) return "no wallet";
  return `$${(cents / 100).toFixed(2)}`;
}

async function main() {
  const backfill = process.argv.includes("--backfill");
  const token = await getAccessToken();

  const docs = await queryPrivilegedUsers(token);

  if (docs.length === 0) {
    console.log("No accounts hold a privileged role.");
    return;
  }

  console.log(`${docs.length} account(s) hold a privileged role:\n`);

  const rows = [];
  for (const doc of docs) {
    const uid = doc.name.split("/").pop();
    const role = str(doc, "accountType");
    const [balance, txCount] = await Promise.all([
      getWalletBalance(token, uid),
      countTransactions(token, uid),
    ]);
    rows.push({
      uid,
      role,
      name: str(doc, "fullName") || "(no name)",
      phone: str(doc, "phoneNumber") || "(no phone)",
      kyc: str(doc, "kycStatus") || "unknown",
      balance,
      txCount,
    });
  }

  rows.sort((a, b) => b.txCount - a.txCount);

  for (const r of rows) {
    console.log(
      `  ${r.role.padEnd(15)} ${r.name.padEnd(24)} ${r.phone.padEnd(16)} ` +
        `kyc=${r.kyc.padEnd(10)} balance=${money(r.balance).padEnd(12)} ` +
        `txs=${String(r.txCount).padEnd(6)} ${r.uid}`
    );
  }

  if (!backfill) {
    console.log(
      "\nReport only. Re-run with --backfill to file each as a pending role " +
        "request for review in the admin console.\n" +
        "Nobody's role changes until an admin decides."
    );
    return;
  }

  console.log("\nFiling pending role requests...");
  let created = 0;
  let existed = 0;
  for (const r of rows) {
    const outcome = await fileRoleRequest(token, r.uid, r.role, r.name);
    if (outcome === "created") created++;
    else existed++;
  }

  console.log(
    `Done: ${created} request(s) filed, ${existed} already had one.\n` +
      "Review them in the admin console: approving keeps the role, " +
      "rejecting demotes the account to customer."
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

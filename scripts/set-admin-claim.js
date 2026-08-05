#!/usr/bin/env node
/**
 * Grant or revoke admin console access.
 *
 * Usage:
 *   node scripts/set-admin-claim.js <email|uid> <role...>
 *   node scripts/set-admin-claim.js admin@example.com super
 *   node scripts/set-admin-claim.js admin@example.com ops compliance
 *   node scripts/set-admin-claim.js admin@example.com --revoke
 *   node scripts/set-admin-claim.js --list
 *
 * This script is deliberately the ONLY way to grant admin authority: there is
 * no callable that does it, so privilege escalation requires project-level
 * credentials rather than a phished console session.
 *
 * Auth: exchanges your Firebase CLI login for an OAuth access token and calls
 * the Identity Toolkit REST API (same approach as audit-privileged-accounts.js).
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const PROJECT_ID = "quickpay-485417";
const IDENTITY = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;

const VALID_ROLES = ["super", "ops", "compliance"];

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

async function api(token, url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${url} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function lookupAccount(token, target) {
  const body = target.includes("@") ? { email: [target] } : { localId: [target] };
  const json = await api(token, `${IDENTITY}/accounts:lookup`, body);
  return json.users && json.users[0];
}

function parseClaims(user) {
  if (!user.customAttributes) return {};
  try {
    return JSON.parse(user.customAttributes);
  } catch {
    return {};
  }
}

async function listAdmins(token) {
  // Identity Toolkit has no "query by claim", so this walks the account list
  // and filters locally. Fine at pilot scale; revisit if the user base grows
  // past a few tens of thousands.
  const PAGE = 500;
  const MAX_PAGES = 200; // hard stop so a paging surprise can't spin forever
  const admins = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await api(token, `${IDENTITY}/accounts:query`, {
      returnUserInfo: true,
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    const users = json.userInfo || [];

    for (const user of users) {
      const claims = parseClaims(user);
      if (claims.admin === true) {
        admins.push({
          uid: user.localId,
          email: user.email || "(no email)",
          roles: claims.adminRoles || [],
        });
      }
    }

    if (users.length < PAGE) return admins;
  }

  console.warn(`Stopped after ${MAX_PAGES} pages; list may be incomplete.`);
  return admins;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.error(
      "Usage:\n" +
        "  node scripts/set-admin-claim.js <email|uid> <role...>   roles: " +
        VALID_ROLES.join(" | ") +
        "\n  node scripts/set-admin-claim.js <email|uid> --revoke\n" +
        "  node scripts/set-admin-claim.js --list"
    );
    process.exit(1);
  }

  const token = await getAccessToken();

  if (args[0] === "--list") {
    const admins = await listAdmins(token);
    if (admins.length === 0) {
      console.log("No admin accounts.");
    } else {
      console.log(`${admins.length} admin account(s):`);
      for (const a of admins) {
        console.log(`  ${a.email}  (${a.uid})  roles: ${a.roles.join(", ") || "none"}`);
      }
    }
    return;
  }

  const [target, ...rest] = args;
  const revoke = rest.includes("--revoke");
  const roles = rest.filter((r) => r !== "--revoke");

  if (!revoke) {
    if (roles.length === 0) {
      console.error(`No roles given. Valid roles: ${VALID_ROLES.join(", ")}`);
      process.exit(1);
    }
    const invalid = roles.filter((r) => !VALID_ROLES.includes(r));
    if (invalid.length > 0) {
      console.error(
        `Unknown role(s): ${invalid.join(", ")}. Valid roles: ${VALID_ROLES.join(", ")}`
      );
      process.exit(1);
    }
  }

  const user = await lookupAccount(token, target);
  if (!user) {
    console.error(
      `No Firebase Auth account for "${target}".\n` +
        "The person must sign in to the console once before a role can be granted."
    );
    process.exit(1);
  }

  const existing = parseClaims(user);
  const claims = { ...existing };

  if (revoke) {
    delete claims.admin;
    delete claims.adminRoles;
  } else {
    claims.admin = true;
    claims.adminRoles = roles;
  }

  await api(token, `${IDENTITY}/accounts:update`, {
    localId: user.localId,
    customAttributes: JSON.stringify(claims),
  });

  const who = `${user.email || "(no email)"} (${user.localId})`;
  if (revoke) {
    console.log(`Revoked admin access for ${who}`);
    console.log(
      "Their existing session keeps its old token until it refreshes " +
        "(up to 1 hour). Disable or sign out the account too if this is urgent."
    );
  } else {
    console.log(`Granted admin access to ${who}`);
    console.log(`  roles: ${roles.join(", ")}`);
    console.log(
      "They must sign out and back in (or wait for a token refresh) before " +
        "the console will let them in."
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

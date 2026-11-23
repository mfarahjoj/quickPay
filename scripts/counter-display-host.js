#!/usr/bin/env node
/**
 * Local backend for the counter display site, for development only.
 *
 * Why not the Functions emulator: it wraps `admin.firestore` in a bound
 * function, which drops its static members (`FieldValue`, `Timestamp`), so
 * most of this codebase throws there. The repo's emulator tests call
 * functions in-process for the same reason. This host does that for the
 * browser: it loads the built functions with the real firebase-admin against
 * the Firestore emulator, serves the display's callables at the emulator's
 * URL shape, and runs the three counter-display triggers off live listeners.
 *
 *   firebase emulators:start --only firestore --project demo-zapp
 *   (cd functions && npm run build)
 *   node scripts/counter-display-host.js
 *   (cd display && npm run dev -- --mode emulator)
 *
 * App Check tokens are decoded but not verified (FIREBASE_DEBUG_FEATURES),
 * exactly as under the Functions emulator. Never point this at production:
 * it refuses to start without FIRESTORE_EMULATOR_HOST semantics.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createRequire } = require("module");

const FUNCTIONS = path.resolve(__dirname, "../functions");
const PROJECT = process.env.GCLOUD_PROJECT || "demo-zapp";
const PORT = Number(process.env.PORT || 5001);

if (!PROJECT.startsWith("demo-")) {
  console.error(`Refusing to run against ${PROJECT}: use a demo- project.`);
  process.exit(1);
}
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FUNCTIONS_EMULATOR = "true";
process.env.FIREBASE_DEBUG_MODE = "true";
process.env.FIREBASE_DEBUG_FEATURES =JSON.stringify({ skipTokenVerification: true });
process.env.FIREBASE_CONFIG ||= JSON.stringify({ projectId: PROJECT });

// Dev secrets, as the emulator would read them.
const secretFile = path.join(FUNCTIONS, ".secret.local");
if (fs.existsSync(secretFile)) {
  for (const line of fs.readFileSync(secretFile, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) process.env[m[1]] ||= m[2];
  }
}

const fnRequire = createRequire(path.join(FUNCTIONS, "package.json"));
const admin = fnRequire("firebase-admin");
const fns = fnRequire(path.join(FUNCTIONS, "lib/index.js")); // initializes the default app

const CALLABLES = [
  "startDisplayPairing",
  "pollDisplayPairing",
  "confirmDisplayPairing",
  "displayHeartbeat",
  "displayScanCustomer",
  "displaySignOut",
];

// ── Callables over HTTP ─────────────────────────────────────────────────────
http
  .createServer((req, res) => {
    const name = req.url.split("?")[0].split("/").pop();
    const handler = CALLABLES.includes(name) ? fns[name] : null;
    if (!handler) {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      req.rawBody = raw;
      try {
        req.body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        req.body = {};
      }
      // The bits of express the callable handler and its cors wrapper use.
      req.header = req.get = (h) => req.headers[h.toLowerCase()];
      req.ip = req.socket.remoteAddress;
      res.status = (code) => ((res.statusCode = code), res);
      res.set = res.header = (k, v) => (res.setHeader(k, v), res);
      res.json = (body) => {
        if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify(body));
      };
      res.send = (body) =>
        typeof body === "string" || Buffer.isBuffer(body) ? res.end(body) : res.json(body);
      const startedAt = Date.now();
      res.on("finish", () => console.log(`${name} ${res.statusCode} ${Date.now() - startedAt}ms`));
      Promise.resolve(handler(req, res)).catch((err) => {
        console.error(name, err);
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`counter display host on http://127.0.0.1:${PORT}/${PROJECT}/us-central1/…`));

// ── Triggers off live listeners ─────────────────────────────────────────────
const db = admin.firestore();
const snap = (data) => ({ data: () => data, exists: data !== undefined });

function watch(collection, onChange) {
  const seen = new Map();
  let primed = false;
  db.collection(collection).onSnapshot((qs) => {
    for (const change of qs.docChanges()) {
      const id = change.doc.id;
      const before = seen.get(id);
      const after = change.type === "removed" ? undefined : change.doc.data();
      if (after === undefined) seen.delete(id);
      else seen.set(id, after);
      if (primed) onChange(id, before, after, change.type);
    }
    primed = true; // the first snapshot is what already existed, not events
  });
}

const run = (name, event) =>
  fns[name].run(event).catch((err) => console.error(name, err));

watch("qrCodes", (id, before, after) =>
  run("counterDisplayOnQrCode", { params: { qrCodeId: id }, data: { before: snap(before), after: snap(after) } })
);
watch("paymentRequests", (id, before, after) =>
  run("counterDisplayOnPaymentRequest", { params: { requestId: id }, data: { before: snap(before), after: snap(after) } })
);
watch("transactions", (id, _before, after, type) => {
  if (type === "added") run("counterDisplayOnTransaction", { params: { transactionId: id }, data: snap(after) });
});

#!/usr/bin/env node
/**
 * Local QA only (docs/LOCAL_QA.md): a pass-through in front of the Functions
 * emulator that gives every request a placeholder App Check token.
 *
 * Most callables set `enforceAppCheck: true`. The Functions emulator decodes
 * App Check tokens without verifying them, but a token must still be present,
 * and an app pointed at the emulators deliberately doesn't initialise App
 * Check (it would ask production for a real token). So the apps call this
 * proxy (default :5002) and it forwards to the emulator (default :5001) with
 * an unsigned token naming the calling app.
 *
 * It also prints one line per call (name, status, time), which is the quickest
 * way to see which callables a screen hits and which of them fail.
 *
 * Never point anything that isn't the local emulator at this.
 */
import http from 'node:http';

const LISTEN_PORT = Number(process.env.QA_PROXY_PORT || 5002);
const TARGET_HOST = process.env.QA_FUNCTIONS_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.QA_FUNCTIONS_PORT || 5001);

if (!['127.0.0.1', 'localhost', '::1'].includes(TARGET_HOST)) {
  console.error(`appcheck-proxy: refusing to forward to ${TARGET_HOST}; it only fronts a local emulator.`);
  process.exit(1);
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** An unsigned JWT the emulator's unsafe decoder accepts (`sub` becomes `app_id`). */
function placeholderToken() {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: 'none', typ: 'JWT' }),
    b64url({ sub: 'local-qa', iss: 'local-qa-proxy', aud: ['local-qa'], iat: now, exp: now + 3600 }),
    'unsigned',
  ].join('.');
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const headers = { ...req.headers, 'x-firebase-appcheck': placeholderToken(), host: `${TARGET_HOST}:${TARGET_PORT}` };
  const upstream = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers },
    (up) => {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const body = Buffer.concat(chunks);
        res.writeHead(up.statusCode || 502, up.headers);
        res.end(body);
        const name = (req.url || '').split('?')[0].split('/').pop();
        let note = '';
        if ((up.statusCode || 0) >= 400) {
          try {
            const err = JSON.parse(body.toString()).error;
            note = err ? ` ${err.status || ''} ${err.message || ''}`.trimEnd() : '';
          } catch {
            note = '';
          }
        }
        console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${name} → ${up.statusCode} (${Date.now() - started}ms)${note}`);
      });
    },
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { status: 'UNAVAILABLE', message: `Functions emulator unreachable: ${err.message}` } }));
  });
  req.pipe(upstream);
});

server.listen(LISTEN_PORT, () => {
  console.log(`appcheck-proxy: :${LISTEN_PORT} → ${TARGET_HOST}:${TARGET_PORT} (placeholder App Check token on every call)`);
});

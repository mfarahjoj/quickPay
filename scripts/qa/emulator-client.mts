/**
 * Local QA only (docs/LOCAL_QA.md): what the QA scripts share — the seeded
 * people, and calling the Functions emulator as one of them.
 *
 * Importing this points the Admin SDK at the local emulators and refuses to
 * run if anything says otherwise, so no script built on it can reach prod.
 */
import { createRequire } from 'node:module';

export const PROJECT = 'quickpay-485417';
export const HOST = '127.0.0.1';
export const PORTS = { auth: 9099, firestore: 8080, functions: 5001, storage: 9199, hub: 4400 };
/** Every seeded account's PIN. A test value for the emulators only. */
export const PIN = '739146';

// ── Emulators only ───────────────────────────────────────────────────────────
const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
const emulatorEnv: Record<string, number> = {
  FIRESTORE_EMULATOR_HOST: PORTS.firestore,
  FIREBASE_AUTH_EMULATOR_HOST: PORTS.auth,
  FIREBASE_STORAGE_EMULATOR_HOST: PORTS.storage,
};
for (const [key, port] of Object.entries(emulatorEnv)) {
  const current = process.env[key];
  if (current && !LOCAL.test(current)) {
    console.error(`${key}=${current} is not a local emulator. Refusing to run.`);
    process.exit(1);
  }
  process.env[key] = `${HOST}:${port}`;
}
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.GCLOUD_PROJECT = PROJECT;

// The functions' own firebase-admin, so the scripts and the code under test
// share one SDK.
const requireFromFunctions = createRequire(new URL('../../functions/package.json', import.meta.url));
export const admin = requireFromFunctions('firebase-admin');
admin.initializeApp({ projectId: PROJECT });
export const db = admin.firestore();

// ── People ───────────────────────────────────────────────────────────────────
export interface Person {
  uid: string;
  phone: string;
  name: string;
  accountType: 'customer' | 'merchant' | 'topup_agent';
}
export const amina: Person = { uid: 'qa-amina', phone: '+252634000001', name: 'Amina Warsame', accountType: 'customer' };
export const hodan: Person = { uid: 'qa-hodan', phone: '+252634000002', name: 'Hodan Ali', accountType: 'customer' };
export const cafe: Person = { uid: 'qa-cafe', phone: '+252634000003', name: 'Hargeisa Coffee House', accountType: 'merchant' };
export const agent: Person = { uid: 'qa-agent', phone: '+252634000004', name: 'Daallo Cash Point', accountType: 'topup_agent' };
export const PEOPLE = [amina, hodan, cafe, agent];
export const OPS = { uid: 'qa-ops', email: 'ops@qa.zapp.local', roles: ['ops', 'compliance'] };
export const SUPER = { uid: 'qa-super', email: 'super@qa.zapp.local', roles: ['super'] };

// ── Plumbing ─────────────────────────────────────────────────────────────────
export async function http(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

export async function assertEmulatorsUp(): Promise<void> {
  let hub;
  try {
    hub = await http('GET', `http://${HOST}:${PORTS.hub}/emulators`);
  } catch {
    throw new Error('Emulators are not running. Start them with scripts/qa/emulators.sh.');
  }
  const running = Object.keys(hub.json ?? {});
  for (const name of ['auth', 'firestore', 'functions']) {
    if (!running.includes(name)) throw new Error(`The ${name} emulator is not running.`);
  }
}

/** A fresh ID token (fresh auth_time, which the admin callables require). */
export async function idToken(uid: string): Promise<string> {
  const customToken = await admin.auth().createCustomToken(uid);
  const res = await http(
    'POST',
    `http://${HOST}:${PORTS.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-qa`,
    { token: customToken, returnSecureToken: true },
  );
  if (!res.json?.idToken) throw new Error(`Sign-in failed for ${uid}: ${JSON.stringify(res.json)}`);
  return res.json.idToken;
}

/** The emulator decodes App Check tokens without verifying them; one must still be sent. */
function placeholderAppCheck(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'local-qa-script' })}.unsigned`;
}

/** Call a callable on the Functions emulator as `uid`. */
export async function call<T = any>(uid: string, name: string, data: Record<string, unknown>): Promise<T> {
  const res = await http('POST', `http://${HOST}:${PORTS.functions}/${PROJECT}/us-central1/${name}`, { data }, {
    authorization: `Bearer ${await idToken(uid)}`,
    'x-firebase-appcheck': placeholderAppCheck(),
  });
  if (res.status !== 200 || res.json?.error) {
    const err = res.json?.error ?? res.json;
    throw new Error(`${name}: ${err?.status ?? res.status} ${err?.message ?? JSON.stringify(err)}`);
  }
  return res.json.result as T;
}

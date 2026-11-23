/**
 * What the tablet keeps in localStorage. Every access is guarded: a private
 * window or cleared site data must never take the counter screen down.
 */
import type { CounterDisplayState, DisplayCreds, Lang } from "./types";

const CREDS = "zapp.display.creds";
const IDLE = "zapp.display.idle";
const SETTINGS = "zapp.display.settings";
const LAST_ERROR = "zapp.display.lastError";
const WAKE_HINT = "zapp.display.wakeHintSeen";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the screen still works for this session */
  }
}

const HEX64 = /^[a-f0-9]{64}$/;
export function loadCreds(): DisplayCreds | null {
  const c = read<DisplayCreds>(CREDS);
  if (!c || !/^cd_[a-f0-9]{24}$/.test(c.displayId) || !HEX64.test(c.displaySecret) || !HEX64.test(c.stateKey)) {
    return null;
  }
  return c;
}
export const saveCreds = (c: DisplayCreds) => write(CREDS, c);
export function clearCreds(): void {
  write(CREDS, null);
  write(IDLE, null);
}

/** Only what Idle needs, so a reload during an outage still shows My QR. */
export interface CachedIdle {
  merchantName: string;
  idleQr: string;
  lang: Lang;
}
export const loadCachedIdle = () => read<CachedIdle>(IDLE);
export const saveCachedIdle = (s: CounterDisplayState) =>
  write(IDLE, { merchantName: s.merchantName, idleQr: s.idleQr, lang: s.lang } satisfies CachedIdle);

export interface Settings {
  /** null follows the shop's language. */
  lang: Lang | null;
  scanner: boolean;
  /** Read scans from a hidden input instead of keydown (Android "Unidentified" keys). */
  scannerCompat: boolean;
  camera: boolean;
  sound: boolean;
}
export const DEFAULT_SETTINGS: Settings = { lang: null, scanner: true, scannerCompat: false, camera: false, sound: true };
export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...(read<Partial<Settings>>(SETTINGS) ?? {}) });
export const saveSettings = (s: Settings) => write(SETTINGS, s);

export const loadLastError = () => read<string>(LAST_ERROR);
export const saveLastError = (msg: string | null) => write(LAST_ERROR, msg ? msg.slice(0, 200) : null);

export const wakeHintSeen = () => read<boolean>(WAKE_HINT) === true;
export const markWakeHintSeen = () => write(WAKE_HINT, true);

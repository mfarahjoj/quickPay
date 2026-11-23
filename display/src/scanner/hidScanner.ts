/**
 * Turns keystrokes from a USB/Bluetooth scanner in keyboard mode into
 * customer codes. Pure: the caller feeds it `event.key` and a timestamp.
 *
 * - one-character keys are appended; Enter or Tab ends a scan;
 * - a gap over 150 ms clears the buffer (people type slower than scanners);
 * - only buffers of 60+ characters that normalise count;
 * - the same code again within 3 s is ignored (scanners double-read).
 */
import { normaliseScannedToken } from "./tokenFormat";

export const KEY_GAP_MS = 150;
export const MIN_LENGTH = 60;
export const REPEAT_MS = 3000;
const MAX_BUFFER = 4096;

export interface HidAssembler {
  /** Returns a normalised token when this key completes a scan, else null. */
  feed(key: string, atMs: number): string | null;
  /** A whole string from another source (compat input, camera), same rules. */
  submit(raw: string, atMs: number): string | null;
  /** What has been typed since the last terminator, for the scanner test. */
  buffer(): string;
  reset(): void;
}

export function createHidAssembler(): HidAssembler {
  let buf = "";
  let lastKeyAt = -Infinity;
  let lastToken: string | null = null;
  let lastTokenAt = -Infinity;

  function submit(raw: string, atMs: number): string | null {
    if (raw.trim().length < MIN_LENGTH) return null;
    const token = normaliseScannedToken(raw);
    if (!token) return null;
    if (token === lastToken && atMs - lastTokenAt < REPEAT_MS) return null;
    lastToken = token;
    lastTokenAt = atMs;
    return token;
  }

  return {
    feed(key, atMs) {
      if (atMs - lastKeyAt > KEY_GAP_MS) buf = "";
      lastKeyAt = atMs;
      if (key === "Enter" || key === "Tab") {
        const done = buf;
        buf = "";
        return done ? submit(done, atMs) : null;
      }
      if (key.length !== 1) return null; // Shift, CapsLock, Unidentified, …
      if (buf.length < MAX_BUFFER) buf += key;
      return null;
    },
    submit,
    buffer: () => buf,
    reset() {
      buf = "";
      lastKeyAt = -Infinity;
    },
  };
}

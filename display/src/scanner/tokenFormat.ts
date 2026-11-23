/**
 * Copy of functions/src/counterDisplay/tokenFormat.ts. Both are tested against
 * functions/src/counterDisplay/__fixtures__/scannedTokens.json, so change them together.
 *
 * A scanner in keyboard mode types the code through the tablet's layout: `:`
 * can arrive as another character and Caps Lock can flip case. The payload is
 * hex, so both are recoverable.
 */
const TOKEN = /^v2[^0-9a-f]([0-9a-f]{24})[^0-9a-f]([0-9a-f]{32})[^0-9a-f]([0-9a-f]{2,})$/;

export function normaliseScannedToken(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  const cleaned = raw.trim().replace(/[\r\n\t]/g, "").toLowerCase();
  const m = TOKEN.exec(cleaned);
  if (!m) return null;
  return `v2:${m[1]}:${m[2]}:${m[3]}`;
}

/**
 * Reading a customer's Zapp code as a counter scanner delivers it.
 *
 * The customer app shows `encrypt(payload)`: `v2:<24 hex>:<32 hex>:<hex…>`
 * (utils/encryption.ts: 12-byte nonce, 16-byte tag). A USB or Bluetooth
 * scanner in keyboard mode "types" that through the tablet's keyboard layout,
 * so a non-US layout can turn `:` into another character and Caps Lock can
 * flip the case. Both are recoverable because the payload is hex; a layout
 * that changes the digits themselves is not, which is what the display's
 * scanner test is for.
 *
 * The display site has a copy of this function (display/src/scanner/
 * tokenFormat.ts). Both are tested against
 * counterDisplay/__fixtures__/scannedTokens.json.
 */

const TOKEN = /^v2[^0-9a-f]([0-9a-f]{24})[^0-9a-f]([0-9a-f]{32})[^0-9a-f]([0-9a-f]{2,})$/;

/** The token as the server wrote it, or null when the text isn't a Zapp code. */
export function normaliseScannedToken(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  const cleaned = raw.trim().replace(/[\r\n\t]/g, "").toLowerCase();
  const m = TOKEN.exec(cleaned);
  if (!m) return null;
  return `v2:${m[1]}:${m[2]}:${m[3]}`;
}

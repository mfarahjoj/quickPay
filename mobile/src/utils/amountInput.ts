// Money amounts are typed as text and sent as integer cents, so the text must
// never hold more than two decimals or a digit the parser can't read.

const MAX_WHOLE_DIGITS = 7;

// Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits, as Arabic and
// Persian keyboards type them, become ASCII digits.
function toAsciiDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Cleans free-typed amount text (TextInput): local digits become ASCII, a comma
 * or Arabic decimal separator becomes '.', anything else is dropped, and the
 * result keeps one decimal point and at most two decimals.
 */
export function normalizeAmountText(raw: string): string {
  const ascii = toAsciiDigits(raw).replace(/[,٫]/g, '.');
  let out = '';
  for (const ch of ascii) {
    if (ch >= '0' && ch <= '9') {
      const dot = out.indexOf('.');
      if (dot >= 0 && out.length - dot > 2) continue;
      if (dot < 0 && out.replace(/^0+/, '').length >= MAX_WHOLE_DIGITS) continue;
      out = out === '0' ? ch : out + ch;
    } else if (ch === '.' && !out.includes('.')) {
      out = (out || '0') + '.';
    }
  }
  return out;
}

/** Applies one keypad press ('0'-'9', '.', or '⌫') to amount text. */
export function appendAmountKey(prev: string, key: string): string {
  if (key === '⌫') return prev.slice(0, -1);
  return normalizeAmountText(prev + key);
}

/** Parses normalized amount text to integer cents (0 if empty). */
export function amountTextToCents(text: string): number {
  const n = Number(text || '0');
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

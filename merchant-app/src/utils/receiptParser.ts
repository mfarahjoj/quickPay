import { toCents } from './money';

/**
 * Turns the text read off a photographed till receipt into the two things a
 * sale needs: the dollar total, and the number the merchant's own system uses
 * to identify the sale.
 *
 * Pure and engine-agnostic on purpose: it takes lines of text (with their
 * position on the page when the OCR engine gives one) and knows nothing about
 * cameras or native modules, so it can be tested against real receipts.
 *
 * Nothing here is trusted to charge on its own. The result pre-fills the
 * Receive screen and the merchant confirms it before a code is shown.
 */

export interface OcrFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrPoint {
  x: number;
  y: number;
}

/** The four corners of a line as printed, which need not be level. */
export interface OcrCorners {
  topLeft: OcrPoint;
  topRight: OcrPoint;
  bottomLeft: OcrPoint;
  bottomRight: OcrPoint;
}

export interface OcrLine {
  text: string;
  /** Upright box around the line. Inflated when the line is tilted. */
  frame?: OcrFrame;
  /** True corners of the line. Preferred over `frame` when present. */
  corners?: OcrCorners;
}

export interface ReceiptIdentifier {
  /**
   * Stable key for the kind of number ("invoice", "kot", "order"…). This is
   * what gets remembered per merchant, so an OCR wobble between "No." and
   * "No" doesn't lose the preference.
   */
  kind: string;
  /** Label as printed, tidied: "Invoice No", "KOT No". */
  label: string;
  value: string;
}

export interface ParsedReceipt {
  /** Dollar total in cents, or null when no trustworthy total was found. */
  amountCents: number | null;
  /** Every plausible sale identifier, best guess first. */
  identifiers: ReceiptIdentifier[];
  /** The receipt as reconstructed rows, top to bottom. */
  rows: string[];
}

export const REFERENCE_MAX_LENGTH = 40;

// ── Rows ──────────────────────────────────────────────────────────────────

interface Placed {
  text: string;
  /** Position along the print direction. */
  along: number;
  /** Position down the page, across the print direction. */
  down: number;
  /** Height of the printed line itself. */
  height: number;
}

const dist = (a: OcrPoint, b: OcrPoint) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * How far the receipt is rotated in the photo, in radians. Each line reports
 * its own slope; long lines know theirs far better than a three-character
 * ".06" does, so the answer is the median slope weighted by line length.
 */
export function estimateSkew(lines: OcrLine[]): number {
  const slopes = lines
    .filter((l) => l.corners)
    .map((l) => {
      const { topLeft, topRight } = l.corners!;
      return {
        angle: Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x),
        weight: dist(topLeft, topRight),
      };
    })
    .filter((s) => s.weight > 0)
    .sort((a, b) => a.angle - b.angle);

  const total = slopes.reduce((sum, s) => sum + s.weight, 0);
  if (total === 0) return 0;

  let seen = 0;
  for (const s of slopes) {
    seen += s.weight;
    if (seen >= total / 2) return s.angle;
  }
  return 0;
}

/**
 * Put every line into the receipt's own axes. With corners, the photo's tilt
 * is measured and undone, so a receipt held at an angle lines up exactly as a
 * level one does. Without corners, the upright frames are used as they are.
 */
function place(lines: OcrLine[]): Placed[] | null {
  if (lines.every((l) => l.corners)) {
    const skew = estimateSkew(lines);
    const cos = Math.cos(skew);
    const sin = Math.sin(skew);
    return lines.map((l) => {
      const { topLeft, topRight, bottomLeft, bottomRight } = l.corners!;
      const cx = (topLeft.x + topRight.x + bottomLeft.x + bottomRight.x) / 4;
      const cy = (topLeft.y + topRight.y + bottomLeft.y + bottomRight.y) / 4;
      const halfWidth = dist(topLeft, topRight) / 2;
      return {
        text: l.text,
        // Left edge, so two columns on one row keep their printed order.
        along: cx * cos + cy * sin - halfWidth,
        down: -cx * sin + cy * cos,
        height: Math.max((dist(topLeft, bottomLeft) + dist(topRight, bottomRight)) / 2, 1),
      };
    });
  }

  if (lines.every((l) => l.frame)) {
    return lines.map((l) => ({
      text: l.text,
      along: l.frame!.left,
      down: l.frame!.top + l.frame!.height / 2,
      height: Math.max(l.frame!.height, 1),
    }));
  }

  return null;
}

/**
 * Receipts are tables: "Total with Tax:" sits at the left edge and "2.56" at
 * the right, and OCR engines hand those back as separate lines. Rebuild the
 * printed rows by grouping lines that sit at the same height on the paper.
 */
export function buildRows(lines: OcrLine[]): string[] {
  const clean = lines
    .map((l) => ({ ...l, text: (l.text ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0);

  if (clean.length === 0) return [];

  const placed = place(clean);
  if (!placed) return clean.map((l) => l.text);

  const items = placed.sort((a, b) => a.down - b.down);

  const rows: { down: number; height: number; items: Placed[] }[] = [];
  for (const item of items) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(item.down - row.down) < Math.min(row.height, item.height) * 0.6) {
      row.items.push(item);
      row.down = row.items.reduce((sum, i) => sum + i.down, 0) / row.items.length;
      row.height = Math.min(row.height, item.height);
    } else {
      rows.push({ down: item.down, height: item.height, items: [item] });
    }
  }

  return rows.map((row) =>
    row.items
      .sort((a, b) => a.along - b.along)
      .map((i) => i.text)
      .join(' ')
  );
}

// ── Sale identifier ───────────────────────────────────────────────────────

/**
 * Words that introduce a sale identifier, with how likely each is to be THE
 * identifier when a receipt carries several. Every merchant's till prints
 * something different, so this only orders the suggestions: the merchant's
 * own pick is remembered and outranks all of it.
 */
const IDENTIFIER_KINDS: { kind: string; pattern: string; rank: number }[] = [
  { kind: 'invoice', pattern: 'invoice|inv', rank: 100 },
  { kind: 'receipt', pattern: 'receipt|rcpt', rank: 90 },
  { kind: 'bill', pattern: 'bill', rank: 80 },
  { kind: 'order', pattern: 'order', rank: 70 },
  { kind: 'ticket', pattern: 'ticket', rank: 60 },
  { kind: 'check', pattern: 'check|chk', rank: 60 },
  { kind: 'transaction', pattern: 'transaction|trans|txn|trx', rank: 50 },
  { kind: 'reference', pattern: 'reference|ref', rank: 45 },
  { kind: 'voucher', pattern: 'voucher', rank: 40 },
  { kind: 'docket', pattern: 'docket|folio|slip|serial', rank: 40 },
  { kind: 'kot', pattern: 'kot', rank: 30 },
  { kind: 'table', pattern: 'table', rank: 10 },
];

/** Labels that take a number but never identify a sale. */
const NOT_AN_IDENTIFIER =
  /^(tel|telephone|phone|mobile|whatsapp|fax|zaad|edahab|e-dahab|premier|wallet|account|acc|acct|tin|vat|tax|reg|licence|license|pos|terminal|till|of|item|items|qty|po\s*box|box)$/i;

const QUALIFIER = '(?:no|num|number|nbr|nr|id|#|№)';
// The value: starts with a letter or digit, may carry - or /, and (checked
// separately) must contain at least one digit.
const VALUE = '([A-Za-z0-9][A-Za-z0-9\\-/]{0,19})';
const TAIL = new RegExp(`^\\s*(${QUALIFIER})?\\s*[.:#\\-]*\\s*${VALUE}`, 'i');
const KNOWN = new RegExp(
  `\\b(${IDENTIFIER_KINDS.map((k) => k.pattern).join('|')})\\b`,
  'gi'
);
// Anything else printed as "<word> No: 123" — a till we haven't met yet.
const GENERIC = new RegExp(
  `\\b([A-Za-z][A-Za-z.]{1,14})\\s+(${QUALIFIER})\\s*[.:#\\-]*\\s*${VALUE}`,
  'gi'
);

function kindOf(word: string): { kind: string; rank: number } | null {
  const lower = word.toLowerCase();
  for (const k of IDENTIFIER_KINDS) {
    if (new RegExp(`^(?:${k.pattern})$`, 'i').test(lower)) return { kind: k.kind, rank: k.rank };
  }
  return null;
}

function tidyLabel(word: string, qualifier?: string): string {
  const base = word.replace(/[.:]+$/, '');
  const q = (qualifier ?? '').replace(/[.:]+$/, '');
  return q ? `${base} ${q}` : base;
}

const hasDigit = (s: string) => /\d/.test(s);
// "22/10/26" after "Order" is a date, not an order number.
const looksLikeDate = (s: string) => /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(s);

export function findIdentifiers(rows: string[], preferredKind?: string | null): ReceiptIdentifier[] {
  const found: (ReceiptIdentifier & { rank: number; order: number })[] = [];
  const seen = new Set<string>();
  let order = 0;

  const add = (kind: string, rank: number, label: string, rawValue: string) => {
    const value = rawValue.replace(/[-/]+$/, '');
    if (!hasDigit(value) || looksLikeDate(value)) return;
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, label, value, rank, order: order++ });
  };

  for (const row of rows) {
    // Known labels. Each keyword is matched on its own and the tail read from
    // there, so "TABLE ORDER KOT No.: 65" still yields the KOT number even
    // though "ORDER" matched first and found nothing after it.
    KNOWN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KNOWN.exec(row)) !== null) {
      const known = kindOf(m[1]);
      if (!known) continue;
      const tail = TAIL.exec(row.slice(m.index + m[0].length));
      if (!tail) continue;
      add(known.kind, known.rank, tidyLabel(m[1], tail[1]), tail[2]);
    }

    GENERIC.lastIndex = 0;
    while ((m = GENERIC.exec(row)) !== null) {
      const word = m[1].replace(/[.:]+$/, '');
      if (NOT_AN_IDENTIFIER.test(word) || kindOf(word)) continue;
      add(word.toLowerCase(), 20, tidyLabel(word, m[2]), m[3]);
    }
  }

  const preferred = preferredKind?.toLowerCase();
  return found
    .sort((a, b) => {
      const ap = a.kind === preferred ? 1 : 0;
      const bp = b.kind === preferred ? 1 : 0;
      return bp - ap || b.rank - a.rank || a.order - b.order;
    })
    .map(({ kind, label, value }) => ({ kind, label, value }));
}

/** What goes into the sale's reference: "Invoice No 37841". */
export function identifierToReference(id: ReceiptIdentifier): string {
  return `${id.label} ${id.value}`.slice(0, REFERENCE_MAX_LENGTH).trim();
}

// ── Total ─────────────────────────────────────────────────────────────────

/**
 * Zapp charges in dollars. A Hargeisa receipt usually prints the shilling
 * equivalent right under the dollar total, and that line must never be read
 * as dollars.
 */
const SHILLING_ROW = /shilling|sl\.?sh|sls\b|slsh|\bsos\b/i;

const FINAL_TOTAL =
  /grand\s*total|total\s*(?:with|incl\w*|inc\.?|after)\s*(?:tax|vat)|amount\s*(?:due|payable)|net\s*(?:total|amount|payable)|balance\s*due|total\s*(?:due|payable|usd)|total\s*to\s*pay/i;
const PLAIN_TOTAL = /\btotal\b/i;
const NOT_A_TOTAL =
  /sub\s*-?\s*total|\btax\b|\bvat\b|discount|change|tendered|received|\bpaid\b|\bcash\b|\btip\b|service|no\.?\s*of|items?\b|qty/i;

// 1,234.56 · 12.5 · .06 — a decimal part is required unless a $ leads, so a
// stray invoice or table number on the same row can't become the amount.
const MONEY = /\$\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*\.\d{1,2}|(?<![\d.])\.\d{2}\b/g;

/**
 * No phone-QR sale is this large, and shilling totals always are (a $2.56
 * coffee is 30,720 shillings). An unlabelled figure at or above this is
 * treated as shillings and left for the merchant to type.
 */
const MAX_PLAUSIBLE_CENTS = 1_000_000;

function lastMoneyCents(row: string): number | null {
  const matches = row.match(MONEY);
  if (!matches) return null;
  const raw = matches[matches.length - 1].replace(/[$,\s]/g, '');
  const cents = toCents(raw.startsWith('.') ? `0${raw}` : raw);
  return cents > 0 ? cents : null;
}

export function findTotalCents(rows: string[]): number | null {
  let best: { cents: number; score: number } | null = null;

  rows.forEach((row, i) => {
    if (SHILLING_ROW.test(row)) return;

    let score = 0;
    if (FINAL_TOTAL.test(row)) score = 3;
    else if (NOT_A_TOTAL.test(row)) return;
    else if (PLAIN_TOTAL.test(row)) score = 2;
    else return;

    let cents = lastMoneyCents(row);
    // Label on one row, figure alone on the next.
    if (cents === null) {
      const next = rows[i + 1];
      if (next && /^[\s$\d.,]+$/.test(next)) cents = lastMoneyCents(next);
    }
    if (cents === null || cents >= MAX_PLAUSIBLE_CENTS) return;

    // Later rows win ties: the figure to pay is printed below the subtotals.
    if (!best || score >= best.score) best = { cents, score };
  });

  return best ? (best as { cents: number }).cents : null;
}

// ── Entry point ───────────────────────────────────────────────────────────

export function parseReceipt(lines: OcrLine[], preferredKind?: string | null): ParsedReceipt {
  const rows = buildRows(lines);
  return {
    amountCents: findTotalCents(rows),
    identifiers: findIdentifiers(rows, preferredKind),
    rows,
  };
}

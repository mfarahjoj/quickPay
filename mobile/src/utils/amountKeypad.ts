/** A key on the amount keypad. */
export type AmountKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'del';

/** As long as the amount field the keypad replaced: 10 characters. */
export const MAX_AMOUNT_LENGTH = 10;

/**
 * The amount after a key press: digits with at most one point and two
 * decimals, no leading zeros, and no longer than MAX_AMOUNT_LENGTH.
 */
export function pressAmountKey(current: string, key: AmountKey): string {
  if (key === 'del') return current.slice(0, -1);

  if (key === '.') {
    if (current.includes('.') || current.length >= MAX_AMOUNT_LENGTH - 1) return current;
    return current === '' ? '0.' : `${current}.`;
  }

  const point = current.indexOf('.');
  if (point >= 0 && current.length - point > 2) return current;
  if (current === '0') return key;
  if (current.length >= MAX_AMOUNT_LENGTH) return current;
  return current + key;
}

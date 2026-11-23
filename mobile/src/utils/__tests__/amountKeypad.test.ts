import { pressAmountKey, type AmountKey } from '../amountKeypad';

/** Presses each character in turn; '<' is the delete key. */
const press = (keys: string) =>
  Array.from(keys).reduce(
    (amount, key) => pressAmountKey(amount, (key === '<' ? 'del' : key) as AmountKey),
    '',
  );

describe('pressAmountKey', () => {
  it('builds an amount from digits and a point', () => {
    expect(press('12.40')).toBe('12.40');
  });

  it('drops a leading zero', () => {
    expect(press('05')).toBe('5');
    expect(press('00')).toBe('0');
  });

  it('puts a zero before a leading point', () => {
    expect(press('.5')).toBe('0.5');
  });

  it('allows one point and two decimals', () => {
    expect(press('1.2.3')).toBe('1.23');
    expect(press('1.234')).toBe('1.23');
  });

  it('deletes the last character', () => {
    expect(press('12.4<')).toBe('12.');
    expect(press('<')).toBe('');
  });

  it('stops at ten characters', () => {
    expect(press('12345678901')).toBe('1234567890');
    expect(press('123456789.')).toBe('123456789');
  });
});

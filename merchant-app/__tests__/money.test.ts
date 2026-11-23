import { formatAmount, sanitizeAmountFor, toAmount } from '../src/utils/money';

jest.mock('../src/config/constants', () => ({ CURRENCY_SYMBOL: '$' }));

describe('amounts typed in shillings or dollars', () => {
  it('reads dollars as cents, exactly', () => {
    expect(toAmount('12.34', 'USD')).toBe(1234);
    expect(toAmount('0.29', 'USD')).toBe(29);
    expect(sanitizeAmountFor('10.999', 'USD')).toBe('10.99');
  });

  it('reads shillings as whole shillings, with no decimals', () => {
    expect(toAmount('100000', 'SLS')).toBe(100_000);
    expect(sanitizeAmountFor('20,000.50', 'SLS')).toBe('20000');
    expect(toAmount('20000.50', 'SLS')).toBe(20_000);
    expect(toAmount('', 'SLS')).toBe(0);
  });

  it('never shows shillings as cents', () => {
    expect(formatAmount(100_000, 'SLS')).toBe('100,000 SLSH');
    expect(formatAmount(100_000, 'USD')).toBe('$1,000.00');
  });
});

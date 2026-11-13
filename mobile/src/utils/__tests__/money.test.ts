import { balanceIn, formatMajor, formatMoney, leadCurrency, moneyParts, toCurrency } from '../money';

describe('money', () => {
  it('formats each currency from its smallest unit', () => {
    expect(formatMoney(1250, 'USD')).toBe('$12.50');
    expect(formatMoney(123456789, 'USD')).toBe('$1,234,567.89');
    expect(formatMoney(30000, 'SLS')).toBe('30,000 SLSH');
    expect(formatMoney(30000, 'SLSH')).toBe('30,000 SLSH');
    expect(formatMoney(-500, 'SLS')).toBe('-500 SLSH');
  });

  it('formats whole units as getTransactions sends them', () => {
    expect(formatMajor(12.5, 'USD')).toBe('$12.50');
    expect(formatMajor(30000, 'SLS')).toBe('30,000 SLSH');
  });

  it('reads anything that is not shillings as dollars', () => {
    expect(toCurrency('SLS')).toBe('SLS');
    expect(toCurrency('SLSH')).toBe('SLS');
    expect(toCurrency(undefined)).toBe('USD');
  });

  it('leads with shillings unless someone only ever held dollars', () => {
    expect(leadCurrency(0, 0)).toBe('SLS');
    expect(leadCurrency(0, 5000)).toBe('SLS');
    expect(leadCurrency(1250, 5000)).toBe('SLS');
    expect(leadCurrency(1250, 0)).toBe('USD');
  });

  it('splits a balance for the big display', () => {
    expect(moneyParts(1250, 'USD')).toEqual({ main: '$12', tail: '.50' });
    expect(moneyParts(30000, 'SLS')).toEqual({ main: '30,000', tail: ' SLSH' });
  });

  it('takes a payment from the balance in its own currency', () => {
    const wallet = { balanceCents: 1250, slsBalance: 30000 };
    expect(balanceIn(wallet, 'USD')).toBe(1250);
    expect(balanceIn(wallet, 'SLS')).toBe(30000);
    expect(balanceIn(null, 'SLS')).toBe(0);
  });
});

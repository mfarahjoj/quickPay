import {
  amountInputLabel,
  amountInputUnits,
  balanceIn,
  formatMajor,
  formatMoney,
  leadCurrency,
  moneyParts,
  otherCurrency,
  toCurrency,
} from '../money';

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

  it('switches to the other currency', () => {
    expect(otherCurrency('SLS')).toBe('USD');
    expect(otherCurrency('USD')).toBe('SLS');
  });

  it('reads a typed amount in its smallest unit', () => {
    expect(amountInputUnits('12.5', 'USD')).toBe(1250);
    expect(amountInputUnits('0.07', 'USD')).toBe(7);
    expect(amountInputUnits('30000', 'SLS')).toBe(30000);
    expect(amountInputUnits('', 'USD')).toBe(0);
    expect(amountInputUnits('0.', 'USD')).toBe(0);
    expect(amountInputUnits('', 'SLS')).toBe(0);
  });

  it('shows a typed amount while it is being typed', () => {
    expect(amountInputLabel('1234.5', 'USD')).toBe('$1,234.5');
    expect(amountInputLabel('12.', 'USD')).toBe('$12.');
    expect(amountInputLabel('', 'USD')).toBe('$0');
    expect(amountInputLabel('30000', 'SLS')).toBe('30,000 SLSH');
    expect(amountInputLabel('', 'SLS')).toBe('0 SLSH');
  });
});

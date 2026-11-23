import { walletFromBalance } from '../walletFromBalance';

const base = {
  balance: 12.5,
  balanceCents: 1250,
  slsBalance: 0,
  currency: 'USD',
  totalReceived: 20,
  totalSent: 7.5,
};

describe('walletFromBalance', () => {
  it('turns the ISO string from getBalance back into a Date, so .getTime() works', () => {
    const w = walletFromBalance(null, { ...base, lastTransactionAt: '2026-11-23T20:00:00.000Z' } as any);
    expect(w.lastTransactionAt).toBeInstanceOf(Date);
    expect(w.lastTransactionAt!.getTime()).toBe(Date.parse('2026-11-23T20:00:00.000Z'));
  });

  it('gives null for no last transaction, or one it cannot read', () => {
    expect(walletFromBalance(null, { ...base, lastTransactionAt: null } as any).lastTransactionAt).toBeNull();
    expect(walletFromBalance(null, { ...base } as any).lastTransactionAt).toBeNull();
    expect(walletFromBalance(null, { ...base, lastTransactionAt: 'nope' } as any).lastTransactionAt).toBeNull();
  });

  it('keeps fields getBalance leaves out from the listener', () => {
    const prev = { ...base, slsTotalReceived: 5000, slsTotalSent: 100, lastTransactionAt: null } as any;
    const w = walletFromBalance(prev, { ...base, balance: 13, lastTransactionAt: null } as any);
    expect(w.balance).toBe(13);
    expect((w as any).slsTotalReceived).toBe(5000);
  });
});

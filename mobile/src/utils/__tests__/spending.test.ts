import { lastSevenDaysSpend } from '../spending';
import type { Transaction } from '../../types';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: `tx${Math.random()}`,
  type: 'payment',
  amount: 10,
  currency: 'USD',
  status: 'completed',
  description: '',
  createdAt: new Date(2026, 10, 7, 8, 0),
  isIncoming: false,
  otherPartyId: 'other',
  ...over,
});

describe('lastSevenDaysSpend', () => {
  const now = new Date(2026, 10, 7, 9, 41);

  it('puts each spend on its day, oldest first and today last', () => {
    const days = lastSevenDaysSpend(
      [
        tx({ amount: 12.4, createdAt: new Date(2026, 10, 7, 9, 0) }),
        tx({ amount: 20, createdAt: new Date(2026, 10, 6, 18, 20) }),
        tx({ amount: 3.5, createdAt: new Date(2026, 10, 6, 7, 55) }),
        tx({ amount: 8, createdAt: new Date(2026, 10, 1, 0, 0) }),
      ],
      now,
    );
    expect(days.map((d) => d.start.getDate())).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days.map((d) => d.value)).toEqual([8, 0, 0, 0, 0, 23.5, 12.4]);
  });

  it('leaves out money in, unfinished payments and older days', () => {
    const days = lastSevenDaysSpend(
      [
        tx({ isIncoming: true, amount: 50 }),
        tx({ status: 'pending', amount: 5 }),
        tx({ status: 'cancelled', amount: 5 }),
        tx({ amount: 9, createdAt: new Date(2026, 9, 31, 23, 59) }),
      ],
      now,
    );
    expect(days.reduce((sum, d) => sum + d.value, 0)).toBe(0);
  });
});

import type { Transaction } from '../types';

export interface DaySpend {
  /** Midnight at the start of the day, local time. */
  start: Date;
  /** Dollars spent that day. */
  value: number;
}

/**
 * Money spent on each of the last seven days, oldest first and today last:
 * completed outgoing transactions, counted the way Insights counts them.
 */
export function lastSevenDaysSpend(transactions: Transaction[], now: Date = new Date()): DaySpend[] {
  const days: DaySpend[] = [];
  for (let back = 6; back >= 0; back--) {
    days.push({ start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - back), value: 0 });
  }
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  for (const tx of transactions) {
    if (tx.isIncoming || tx.status !== 'completed') continue;
    const at = new Date(tx.createdAt);
    if (at < days[0].start || at >= end) continue;
    for (let i = days.length - 1; i >= 0; i--) {
      if (at >= days[i].start) {
        days[i].value += tx.amount;
        break;
      }
    }
  }
  return days;
}

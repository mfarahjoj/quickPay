import { isCompleteLocalNumber, personInitials, recentPeople } from '../recentPeople';

describe('recentPeople', () => {
  const p2p = (phone: string | null, name: string | null, extra: object = {}) => ({
    kind: 'p2p',
    status: 'completed',
    counterpartyPhone: phone,
    counterpartyName: name,
    ...extra,
  });

  it('keeps transfers only, newest first, each person once', () => {
    const rows = [
      p2p('+252634000001', 'Amina Y.'),
      { kind: 'merchant_payment', counterpartyPhone: '+252634000009', counterpartyName: 'Hodan Coffee' },
      p2p('+252634000002', 'Khadar A.'),
      p2p('+252634000001', 'Amina Y.'),
    ];
    expect(recentPeople(rows)).toEqual([
      { phoneNumber: '+252634000001', name: 'Amina Y.' },
      { phoneNumber: '+252634000002', name: 'Khadar A.' },
    ]);
  });

  it('skips failed transfers, rows without a phone, and the customer themself', () => {
    const rows = [
      p2p('+252634000001', 'Amina Y.', { status: 'failed' }),
      p2p(null, 'No phone'),
      p2p('+252634000005', 'Me'),
      p2p('+252634000003', null),
    ];
    expect(recentPeople(rows, 8, '+252634000005')).toEqual([
      { phoneNumber: '+252634000003', name: '+252634000003' },
    ]);
  });

  it('stops at the limit', () => {
    const rows = Array.from({ length: 12 }, (_, i) => p2p(`+25263400${String(i).padStart(4, '0')}`, `P${i}`));
    expect(recentPeople(rows, 5)).toHaveLength(5);
  });
});

describe('isCompleteLocalNumber', () => {
  it('is nine digits, not starting with 0', () => {
    expect(isCompleteLocalNumber('634123456')).toBe(true);
    expect(isCompleteLocalNumber('63 412 3456')).toBe(true);
    expect(isCompleteLocalNumber('63412345')).toBe(false);
    expect(isCompleteLocalNumber('0634123456')).toBe(false);
    expect(isCompleteLocalNumber('+252634123456')).toBe(false);
  });
});

describe('personInitials', () => {
  it('uses the first and last names, or the last two digits of a number', () => {
    expect(personInitials('Amina Yusuf')).toBe('AY');
    expect(personInitials('Khadar')).toBe('K');
    expect(personInitials('+252634000003')).toBe('03');
  });
});

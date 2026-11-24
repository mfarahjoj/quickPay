import { contactEntries, contactNumberToE164, filterContacts } from '../contactPhone';

describe('contactNumberToE164', () => {
  it.each([
    ['063 412 3456', '+252634123456'],
    ['0634123456', '+252634123456'],
    ['634123456', '+252634123456'],
    ['+252 63 412 3456', '+252634123456'],
    ['+252-63-412-3456', '+252634123456'],
    ['00252634123456', '+252634123456'],
    ['252634123456', '+252634123456'],
    ['+252 0 63 412 3456', '+252634123456'],
    ['(063) 412-3456', '+252634123456'],
    ['+44 7700 900123', '+447700900123'],
    ['0044 7700 900123', '+447700900123'],
  ])('%s → %s', (raw, want) => {
    expect(contactNumberToE164(raw)).toBe(want);
  });

  it.each(['', '112', '12345', '+252 63 412', '+252 63 412 34567', '06341234', 'abc', '+0123456789'])(
    'drops %p',
    (raw) => {
      expect(contactNumberToE164(raw)).toBeNull();
    }
  );
});

describe('contactEntries', () => {
  const contacts = [
    {
      recordID: '2',
      displayName: 'Zahra Ali',
      phoneNumbers: [
        { label: 'mobile', number: '063 412 3456' },
        { label: 'home', number: '+252634123456' },
        { label: 'work', number: '112' },
      ],
    },
    { recordID: '1', givenName: 'amina', familyName: 'Yusuf', phoneNumbers: [{ label: 'mobile', number: '0657778888' }] },
    { recordID: '3', company: 'Hargeisa Coffee', phoneNumbers: [{ label: 'work', number: '0631112222' }] },
    { recordID: '4', displayName: 'Me', phoneNumbers: [{ label: 'mobile', number: '0639990000' }] },
    { recordID: '5', displayName: 'No number', phoneNumbers: [] },
  ];

  it('gives one row per usable number, sorted by name, without duplicates or your own number', () => {
    const rows = contactEntries(contacts, '+252639990000');
    expect(rows.map((r) => [r.name, r.phone, r.label])).toEqual([
      ['amina Yusuf', '+252657778888', 'mobile'],
      ['Hargeisa Coffee', '+252631112222', 'work'],
      ['Zahra Ali', '+252634123456', 'mobile'],
    ]);
  });

  it('finds people by name or by the number in any form', () => {
    const rows = contactEntries(contacts);
    expect(filterContacts(rows, 'zah').map((r) => r.name)).toEqual(['Zahra Ali']);
    expect(filterContacts(rows, '0657').map((r) => r.name)).toEqual(['amina Yusuf']);
    expect(filterContacts(rows, '657 77').map((r) => r.name)).toEqual(['amina Yusuf']);
    expect(filterContacts(rows, '  ').length).toBe(rows.length);
  });
});

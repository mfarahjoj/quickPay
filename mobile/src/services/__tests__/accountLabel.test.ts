import { accountLine, firstName, maskPhone } from '../accountLabel';

describe('account label', () => {
  it('masks numbers so the screen never shows a whole one', () => {
    expect(maskPhone('+252634123864')).toBe('063 ••• 3864');
    expect(maskPhone('+447700900123')).toBe('••• 0123');
    expect(maskPhone(undefined)).toBeUndefined();
  });

  it('uses the first name only', () => {
    expect(firstName('  Hodan Ali Warsame ')).toBe('Hodan');
    expect(firstName('')).toBeUndefined();
    expect(firstName(null)).toBeUndefined();
  });

  it('joins what is known', () => {
    expect(accountLine({ name: 'Hodan', phone: '063 ••• 3864' })).toBe('Hodan · 063 ••• 3864');
    expect(accountLine({ phone: '063 ••• 3864' })).toBe('063 ••• 3864');
    expect(accountLine(undefined)).toBeNull();
    expect(accountLine({})).toBeNull();
  });
});

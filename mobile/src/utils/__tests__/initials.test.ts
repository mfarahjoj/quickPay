import { initialsOf } from '../initials';

describe('initialsOf', () => {
  it('takes the first and last names', () => {
    expect(initialsOf('Hodan Ahmed')).toBe('HA');
    expect(initialsOf(' hodan  cali  ahmed ')).toBe('HA');
  });

  it('takes one letter from a single name', () => {
    expect(initialsOf('Hodan')).toBe('H');
  });

  it('is empty without a name', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf(null)).toBe('');
    expect(initialsOf(undefined)).toBe('');
  });

  it('keeps Arabic letters', () => {
    expect(initialsOf('هدى أحمد')).toBe('هأ');
  });
});

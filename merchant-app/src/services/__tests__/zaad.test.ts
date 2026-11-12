import { formatLocal, normaliseSomaliMsisdn, normaliseZaadName } from '../../utils/zaad';

describe('Zaad details', () => {
  it('reads Somali numbers the way the server does', () => {
    expect(normaliseSomaliMsisdn('063 412 3456')).toBe('+252634123456');
    expect(normaliseSomaliMsisdn('+252 63 412 3456')).toBe('+252634123456');
    expect(normaliseSomaliMsisdn('12345')).toBeNull();
  });

  it('takes a full name, not one word or digits', () => {
    expect(normaliseZaadName(' Hooyo   Xasan ')).toBe('Hooyo Xasan');
    expect(normaliseZaadName('Hooyo')).toBeNull();
    expect(normaliseZaadName('Hooyo 063')).toBeNull();
  });

  it('shows numbers the way people read them', () => {
    expect(formatLocal('+252634123456')).toBe('063 412 3456');
  });
});

import { amountCents, canDialUssd, dollars, formatLocal, ussdUrl, zaadTopupsOn } from '../mobileMoney.utils';

describe('mobile money helpers', () => {
  it('escapes # so the dialer keeps the whole code', () => {
    expect(ussdUrl('*880*0634000001*10.00#')).toBe('tel:*880*0634000001*10.00%23');
  });

  it('only dials USSD where the OS allows it', () => {
    expect(canDialUssd('android')).toBe(true);
    expect(canDialUssd('ios')).toBe(false);
  });

  it('shows numbers the way people read them', () => {
    expect(formatLocal('+252634123456')).toBe('063 412 3456');
    expect(formatLocal('+447700900123')).toBe('+447700900123');
  });

  it('reads amounts as cents and refuses anything odd', () => {
    expect(amountCents('5')).toBe(500);
    expect(amountCents('12.5')).toBe(1250);
    expect(amountCents('12.50')).toBe(1250);
    expect(amountCents('0')).toBeNull();
    expect(amountCents('1.234')).toBeNull();
    expect(amountCents('abc')).toBeNull();
    expect(amountCents('')).toBeNull();
  });

  it('formats dollars', () => {
    expect(dollars(500)).toBe('$5.00');
    expect(dollars(10)).toBe('$0.10');
  });

  it('offers Zaad top-ups only when config/app_client says exactly that', () => {
    expect(zaadTopupsOn({ customer: { zaadTopups: true, minCompatLevel: 2 } })).toBe(true);
    expect(zaadTopupsOn({ customer: { zaadTopups: false } })).toBe(false);
    expect(zaadTopupsOn({ customer: { zaadTopups: 'true' } })).toBe(false);
    expect(zaadTopupsOn({ customer: { minCompatLevel: 2 } })).toBe(false);
    expect(zaadTopupsOn({ zaadTopups: true })).toBe(false);
    expect(zaadTopupsOn({ merchant: { zaadTopups: true } })).toBe(false);
    expect(zaadTopupsOn(undefined)).toBe(false);
    expect(zaadTopupsOn(null)).toBe(false);
  });
});

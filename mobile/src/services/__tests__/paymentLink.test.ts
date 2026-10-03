import { parsePaymentLink, normaliseLinkPhone } from '../paymentLink.service';

/**
 * Payment links are untrusted input — any app or web page can open one — so
 * the parser must reject anything that is not exactly a send link and must
 * never pre-fill a malformed recipient or amount.
 */
describe('parsePaymentLink', () => {
  it('parses a partner fare link (Dart Uri encoding: %2B plus, + for space)', () => {
    expect(
      parsePaymentLink('zapppay://send?to=%2B252634120987&amount=4.70&note=Ridy+ride+K3F9')
    ).toEqual({ to: '+252634120987', amount: '4.70', note: 'Ridy ride K3F9' });
  });

  it('recovers a raw plus that form decoding turned into a space', () => {
    expect(parsePaymentLink('zapppay://send?to=+252634120987')).toEqual({ to: '+252634120987' });
  });

  it('accepts local numbers and leaves the prefix to the send screen', () => {
    expect(parsePaymentLink('zapppay://send?to=634120987')?.to).toBe('634120987');
  });

  it('rejects other schemes, other actions and missing or bad recipients', () => {
    for (const url of [
      null,
      '',
      'https://evil.example/send?to=634120987',
      'zapppay://receive?to=634120987',
      'zapppay://send?amount=5',
      'zapppay://send?to=abc',
      'zapppay://send?to=12',
      'zapppay://send?to=%E0%A4%A',
    ]) {
      expect(parsePaymentLink(url)).toBeNull();
    }
  });

  it('drops an amount that is malformed, zero or implausibly large, but keeps the recipient', () => {
    for (const amount of ['0', '-5', '4.705', '1e3', 'abc', '1000.01', '99999']) {
      const link = parsePaymentLink(`zapppay://send?to=634120987&amount=${amount}`);
      expect(link).toEqual({ to: '634120987' });
    }
    expect(parsePaymentLink('zapppay://send?to=634120987&amount=1000')?.amount).toBe('1000');
  });

  it('strips control characters from the note and caps its length', () => {
    const link = parsePaymentLink(`zapppay://send?to=634120987&note=${encodeURIComponent('a\nb\u0007c' + 'x'.repeat(100))}`);
    expect(link?.note?.startsWith('abc')).toBe(true);
    expect(link?.note?.length).toBe(60);
  });
});

describe('normaliseLinkPhone', () => {
  it('normalises international prefixes and separators', () => {
    expect(normaliseLinkPhone('00252 63 412 0987')).toBe('+252634120987');
    expect(normaliseLinkPhone('+44 7507-123456')).toBe('+447507123456');
  });
});

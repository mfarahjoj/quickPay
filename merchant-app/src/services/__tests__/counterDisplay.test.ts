jest.mock('../firebase.config', () => ({ functions: jest.fn(), firestore: jest.fn() }));

import { parsePairingCode } from '../counterDisplay.service';
import { counterDisplayConfig } from '../../hooks/useCounterDisplayOn';

const ID = 'dp_0123456789abcdef01234567';

describe('parsePairingCode', () => {
  it("reads the tablet's QR", () => {
    expect(parsePairingCode(JSON.stringify({ type: 'zapp_display_pair', v: 1, id: ID, code: '12345678' }))).toEqual({
      pairingId: ID,
      code: '12345678',
    });
  });

  it('reads a typed code, with the space the tablet shows', () => {
    expect(parsePairingCode('1234 5678')).toEqual({ code: '12345678' });
    expect(parsePairingCode(' 12345678 ')).toEqual({ code: '12345678' });
    expect(parsePairingCode('1234-5678')).toEqual({ code: '12345678' });
  });

  it('refuses other QR codes', () => {
    expect(parsePairingCode(JSON.stringify({ type: 'zapp_merchant', v: 1, id: ID, code: '12345678' }))).toBeNull();
    expect(parsePairingCode(JSON.stringify({ type: 'zapp_display_pair', v: 2, id: ID, code: '12345678' }))).toBeNull();
    expect(parsePairingCode(JSON.stringify({ type: 'zapp_display_pair', v: 1, id: 'dp_x', code: '12345678' }))).toBeNull();
    expect(parsePairingCode(JSON.stringify({ type: 'zapp_display_pair', v: 1, id: ID, code: '1234' }))).toBeNull();
    expect(parsePairingCode('{not json')).toBeNull();
    expect(parsePairingCode('00020101021226710015so.sps.quickpay')).toBeNull();
    expect(parsePairingCode('v2:abc:def:012')).toBeNull();
  });

  it('refuses short, long and empty codes', () => {
    expect(parsePairingCode('1234567')).toBeNull();
    expect(parsePairingCode('123456789')).toBeNull();
    expect(parsePairingCode('')).toBeNull();
  });
});

describe('counterDisplayConfig', () => {
  it('is on only when the flag is exactly true', () => {
    expect(counterDisplayConfig({ merchant: { counterDisplay: true } }).on).toBe(true);
    expect(counterDisplayConfig({ merchant: { counterDisplay: 'true' } }).on).toBe(false);
    expect(counterDisplayConfig({ merchant: {} }).on).toBe(false);
    expect(counterDisplayConfig(undefined).on).toBe(false);
  });

  it('takes the tablet address only over https', () => {
    expect(counterDisplayConfig({ merchant: { counterDisplayUrl: 'https://zapp-display.web.app' } }).url).toBe(
      'https://zapp-display.web.app'
    );
    expect(counterDisplayConfig({ merchant: { counterDisplayUrl: 'http://example.com' } }).url).toBeNull();
    expect(counterDisplayConfig({ merchant: { counterDisplayUrl: 42 } }).url).toBeNull();
  });
});

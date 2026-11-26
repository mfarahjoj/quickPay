jest.mock('../firebase.config', () => ({ functions: jest.fn(), firestore: jest.fn() }));

import { parsePortalLogin } from '../portal.service';
import en from '../../i18n/locales/en.json';
import so from '../../i18n/locales/so.json';
import ar from '../../i18n/locales/ar.json';

const ID = 'pl_0123456789abcdef01234567';
const CODE = '0123456789abcdef0123456789abcdef';
const qr = (o: object) => JSON.stringify(o);

describe('parsePortalLogin', () => {
  it("reads the computer's sign-in QR", () => {
    expect(parsePortalLogin(qr({ type: 'zapp_portal_login', v: 1, id: ID, code: CODE }))).toEqual({ loginId: ID, code: CODE });
  });

  it('refuses anything else', () => {
    expect(parsePortalLogin(qr({ type: 'zapp_display_pair', v: 1, id: ID, code: CODE }))).toBeNull();
    expect(parsePortalLogin(qr({ type: 'zapp_portal_login', v: 2, id: ID, code: CODE }))).toBeNull();
    expect(parsePortalLogin(qr({ type: 'zapp_portal_login', v: 1, id: 'pl_short', code: CODE }))).toBeNull();
    expect(parsePortalLogin(qr({ type: 'zapp_portal_login', v: 1, id: ID, code: '12345678' }))).toBeNull();
    expect(parsePortalLogin('12345678')).toBeNull();
    expect(parsePortalLogin('{not json')).toBeNull();
    expect(parsePortalLogin('')).toBeNull();
  });
});

describe('Zapp Business strings', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('portal.') || k === 'shopTools.zappBusinessHint');
  const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();

  it('ship in en, so and ar with the same placeholders', () => {
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      const e = (en as Record<string, string>)[k];
      for (const table of [so, ar] as Record<string, string>[]) {
        expect([k, typeof table[k]]).toEqual([k, 'string']);
        expect([k, ph(table[k])]).toEqual([k, ph(e)]);
      }
    }
  });
});

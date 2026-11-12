import { idleLimitMs } from '../idleLimit';

const DAY = 24 * 60 * 60 * 1000;

describe('idleLimitMs', () => {
  it('follows the console setting', () => {
    expect(idleLimitMs(14)).toBe(14 * DAY);
    expect(idleLimitMs(180)).toBe(180 * DAY);
  });

  it('falls back to 30 days when the setting is missing or out of range', () => {
    for (const v of [undefined, null, '14', 0, 6, 181, 12.5]) {
      expect(idleLimitMs(v)).toBe(30 * DAY);
    }
  });
});

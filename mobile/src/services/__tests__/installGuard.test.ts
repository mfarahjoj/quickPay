import { installKind } from '../installGuard.utils';

describe('installKind', () => {
  it('leaves a normal launch alone', () => {
    expect(installKind(true, 0)).toBe('known');
    expect(installKind(true, 12)).toBe('known');
  });

  it('treats an existing install that just got this update as known, not fresh', () => {
    expect(installKind(false, 3)).toBe('updated');
  });

  it('treats an install with nothing stored as fresh, so leftovers are cleared', () => {
    expect(installKind(false, 0)).toBe('fresh');
  });
});

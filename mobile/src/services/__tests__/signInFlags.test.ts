import { createFlag, type FlagStorage } from '../signInFlags.utils';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  let release: () => void = () => undefined;
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  const storage: FlagStorage = {
    // Held until release(), to control when the first read lands.
    getItem: async (key) => {
      await loaded;
      return data[key] ?? null;
    },
    setItem: async (key, value) => {
      data[key] = value;
    },
    removeItem: async (key) => {
      delete data[key];
    },
  };
  return { storage, data, release };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createFlag', () => {
  it('is null until storage has been read, then what storage held', async () => {
    const { storage, release } = memoryStorage({ k: 'true' });
    const flag = createFlag(storage, 'k');
    expect(flag.get()).toBeNull();
    release();
    await flush();
    expect(flag.get()).toBe(true);
  });

  it('reads anything but "true" as false', async () => {
    const { storage, release } = memoryStorage({ k: 'yes' });
    const flag = createFlag(storage, 'k');
    release();
    await flush();
    expect(flag.get()).toBe(false);
  });

  it('keeps a value set before storage was read', async () => {
    // A PIN sign-in marking the PIN checked must not be undone by a slow
    // first read of what an earlier session left.
    const { storage, release } = memoryStorage({});
    const flag = createFlag(storage, 'k');
    await flag.set(true);
    release();
    await flush();
    expect(flag.get()).toBe(true);
  });

  it('tells every subscriber at once, before storage is written', () => {
    const { storage } = memoryStorage({});
    const flag = createFlag(storage, 'k');
    const seen: Array<boolean | null> = [];
    flag.subscribe(() => seen.push(flag.get()));
    flag.set(true);
    expect(seen).toEqual([true]);
  });

  it('stops telling a subscriber that left', () => {
    const { storage } = memoryStorage({});
    const flag = createFlag(storage, 'k');
    const listener = jest.fn();
    const leave = flag.subscribe(listener);
    leave();
    flag.set(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stores true as "true" and removes the key for false', async () => {
    const { storage, data } = memoryStorage({});
    const flag = createFlag(storage, 'k');
    await flag.set(true);
    expect(data.k).toBe('true');
    await flag.set(false);
    expect('k' in data).toBe(false);
  });
});

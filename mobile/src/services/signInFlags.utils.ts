/**
 * A yes/no flag kept in local storage and mirrored in memory
 * (signInFlags.ts). Pure, so it's unit-tested without React Native.
 */
export interface FlagStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface Flag {
  /** Null until storage has been read. */
  get(): boolean | null;
  /** Seen by every subscriber at once; storage follows. */
  set(value: boolean): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createFlag(storage: FlagStorage, key: string): Flag {
  let value: boolean | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: boolean) => {
    value = next;
    listeners.forEach((listener) => listener());
  };

  storage
    .getItem(key)
    .then((stored) => {
      // A set() that got in first is newer than what storage held.
      if (value === null) publish(stored === 'true');
    })
    .catch(() => {
      if (value === null) publish(false);
    });

  return {
    get: () => value,
    async set(next) {
      publish(next);
      try {
        if (next) await storage.setItem(key, 'true');
        else await storage.removeItem(key);
      } catch {
        // Memory has it for this run; at worst the step is asked again next launch.
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

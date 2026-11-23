/**
 * Local QA only (docs/LOCAL_QA.md), preloaded into the Functions emulator by
 * scripts/qa/emulators.sh through NODE_OPTIONS.
 *
 * The emulator wraps firebase-admin in a proxy and hands out
 * `admin.firestore` as `fn.bind(admin)`. A bound function has none of the
 * original's properties, so `admin.firestore.Timestamp` and
 * `admin.firestore.FieldValue` (used ~340 times in functions/src) come back
 * undefined and every money flow fails with "Cannot read properties of
 * undefined". Production doesn't wrap the SDK, so this only ever bites here.
 *
 * The proxy leaves constructors (functions with a named prototype) unbound,
 * so this gives it a named function carrying the same properties instead.
 * It does nothing outside the emulator's function workers.
 */
if (process.env.FUNCTIONS_EMULATOR === 'true') {
  try {
    const { createRequire } = require('node:module');
    const path = require('node:path');
    const admin = createRequire(path.join(process.cwd(), 'package.json'))('firebase-admin');
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(admin), 'firestore');
    if (original && original.get) {
      Object.defineProperty(admin, 'firestore', {
        configurable: true,
        enumerable: false,
        get() {
          const inner = original.get.call(admin);
          // eslint-disable-next-line func-names
          const firestore = function firestore(app) {
            return inner(app);
          };
          for (const key of Reflect.ownKeys(inner)) {
            if (key === 'length' || key === 'name' || key === 'prototype') continue;
            Object.defineProperty(firestore, key, Object.getOwnPropertyDescriptor(inner, key));
          }
          return firestore;
        },
      });
    }
  } catch (err) {
    console.warn(`functions-emulator-shim: not applied (${err && err.message})`);
  }
}

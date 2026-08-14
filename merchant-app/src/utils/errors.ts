/**
 * Map a Firebase callable error onto a translation key.
 *
 * Raw backend messages are English and written for engineers — surfacing them
 * to a merchant in Hargeisa is not an error message, it's noise. Anything
 * unrecognised falls back to a generic localized string; the original is left
 * to the logger.
 */
const CODE_KEYS: Record<string, string> = {
  'functions/unauthenticated': 'qr.errors.unauthenticated',
  'functions/permission-denied': 'qr.errors.permissionDenied',
  'functions/failed-precondition': 'qr.errors.failedPrecondition',
  'functions/invalid-argument': 'qr.errors.invalidArgument',
  'functions/not-found': 'qr.errors.notFound',
  'functions/unavailable': 'qr.errors.unavailable',
  'functions/deadline-exceeded': 'qr.errors.unavailable',
  'functions/resource-exhausted': 'qr.errors.tooMany',
  'functions/internal': 'qr.errors.generic',
};

export function callableErrorKey(error: any): string {
  const code: string | undefined = error?.code;
  if (code && CODE_KEYS[code]) return CODE_KEYS[code];

  // App Check failures surface as unauthenticated with a distinctive message.
  if (typeof error?.message === 'string' && /app.?check/i.test(error.message)) {
    return 'qr.errors.appCheck';
  }

  return 'qr.errors.generic';
}

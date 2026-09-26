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

/**
 * A wrong PIN is the one failure the person fixes by typing again, so the
 * screens send them back to the keypad for it instead of starting over.
 *
 * The callables word it three ways: "Invalid PIN", "Invalid agent PIN"
 * (manualTopup) and "Incorrect PIN" (payrollPayout).
 */
export function isWrongPin(error: any): boolean {
  return (
    error?.code === 'functions/permission-denied' &&
    /\b(invalid|incorrect)(\s+agent)?\s+pin\b/i.test(error?.message ?? '')
  );
}

/**
 * Translation key for a PIN-confirmed action: agent top-up and cash-out
 * confirmation, payouts, payroll.
 *
 * Several failures share a code — a wrong PIN and a frozen account are both
 * permission-denied, an expired code and a short float both
 * failed-precondition — and the QR wording `callableErrorKey` falls back to
 * ("This account can't take payments") would be wrong for all of them. The
 * backend's messages are fixed English strings in this repo, so they are
 * matched here to tell those cases apart.
 */
export function pinActionErrorKey(error: any): string {
  const code: string | undefined = error?.code;
  const message: string = typeof error?.message === 'string' ? error.message : '';

  if (isWrongPin(error)) return 'errors.wrongPin';

  switch (code) {
    case 'functions/resource-exhausted':
      if (/pin/i.test(message)) return 'errors.pinLocked';
      if (/code/i.test(message)) return 'errors.codeLocked';
      break;
    case 'functions/not-found':
      if (/code/i.test(message)) return 'errors.codeNotFound';
      break;
    case 'functions/failed-precondition':
      if (/expired/i.test(message)) return 'errors.codeExpired';
      if (/already used/i.test(message)) return 'errors.codeUsed';
      if (/float/i.test(message)) return 'errors.insufficientFloat';
      if (/pin not set/i.test(message)) return 'errors.pinNotSet';
      if (/balance/i.test(message)) return 'errors.insufficientBalance';
      break;
    case 'functions/permission-denied':
      if (/own top-up/i.test(message)) return 'errors.ownTopup';
      return 'errors.accountRestricted';
  }

  return callableErrorKey(error);
}

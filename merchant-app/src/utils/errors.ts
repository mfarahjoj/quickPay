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

// RNFirebase prints the code at the front of the message: "[functions/not-found] …".
const CODE_PREFIX = /^\[([a-z-]+\/[a-z-]+)\]\s*/i;

/**
 * The error's Firebase code. Several services re-throw a plain
 * `Error(error.message)`, which drops `code` but keeps it at the front of the
 * message, so it is read from there too.
 */
export function errorCode(error: any): string | undefined {
  const code = error?.code;
  if (typeof code === 'string' && code.includes('/')) return code;
  const prefixed = typeof error?.message === 'string' ? CODE_PREFIX.exec(error.message) : null;
  if (prefixed) return prefixed[1].toLowerCase();
  return typeof code === 'string' ? code : undefined;
}

/**
 * What a service re-throws: the failure itself, so its `code` and `details`
 * reach the screen, which explains it from them (`new Error(e.message)` kept
 * only the words). Only something thrown that isn't an Error is wrapped, and
 * keeps its code and details.
 */
export function asError(error: any, fallback: string): Error {
  if (error instanceof Error) return error;
  const message = typeof error?.message === 'string' && error.message ? error.message : fallback;
  return Object.assign(
    new Error(message),
    error?.code ? { code: error.code } : {},
    error?.details ? { details: error.details } : {},
  );
}

export function callableErrorKey(error: any): string {
  const code = errorCode(error);
  if (code && CODE_KEYS[code]) return CODE_KEYS[code];

  // App Check failures surface as unauthenticated with a distinctive message.
  if (typeof error?.message === 'string' && /app.?check/i.test(error.message)) {
    return 'qr.errors.appCheck';
  }

  return 'qr.errors.generic';
}

/** Firebase Auth, while sending and checking the SMS code. */
const AUTH_KEYS: Record<string, string> = {
  'auth/invalid-verification-code': 'errors.smsCodeWrong',
  'auth/missing-verification-code': 'errors.smsCodeWrong',
  'auth/code-expired': 'errors.smsCodeExpired',
  'auth/session-expired': 'errors.smsCodeExpired',
  'auth/too-many-requests': 'errors.tooManyCodes',
  'auth/quota-exceeded': 'errors.tooManyCodes',
  'auth/network-request-failed': 'qr.errors.unavailable',
  'auth/invalid-phone-number': 'errors.invalidPhone',
  'auth/missing-phone-number': 'errors.invalidPhone',
};

/** Codes that mean the same on every screen. */
const GENERIC_CODE_KEYS: Record<string, string> = {
  'functions/unauthenticated': 'qr.errors.unauthenticated',
  'functions/unavailable': 'qr.errors.unavailable',
  'functions/deadline-exceeded': 'qr.errors.unavailable',
  'functions/resource-exhausted': 'qr.errors.tooMany',
  ...AUTH_KEYS,
};

/**
 * Translation key for a screen that is not taking a payment, where
 * `callableErrorKey`'s QR wording ("This account can't take payments") would
 * be wrong. Connection, sign-in and rate-limit failures get their own line;
 * everything else gets the screen's `fallbackKey`.
 */
export function genericErrorKey(error: any, fallbackKey: string): string {
  if (typeof error?.message === 'string' && /app.?check/i.test(error.message)) return 'qr.errors.appCheck';
  const code = errorCode(error);
  if (code && GENERIC_CODE_KEYS[code]) return GENERIC_CODE_KEYS[code];
  if (!code && /network|offline|internet connection|timed out/i.test(error?.message ?? '')) {
    return 'qr.errors.unavailable';
  }
  return fallbackKey;
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
    errorCode(error) === 'functions/permission-denied' &&
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
 *
 * `fallbackKey` is the screen's own failure line for anything unrecognised;
 * without it the QR wording above is used.
 */
export function pinActionErrorKey(error: any, fallbackKey?: string): string {
  const code = errorCode(error);
  const message: string = typeof error?.message === 'string' ? error.message : '';

  if (isWrongPin(error)) return 'errors.wrongPin';
  const reason = error?.details?.reason;
  if (reason === 'pin_reset_cooldown' || reason === 'phone_change_cooldown') return 'errors.sendingPaused';
  if (reason === 'agent_code_attempts') return 'errors.cashOutCodeAttempts';
  if (reason === 'amount_mismatch') return 'errors.topupAmountChanged';
  if (reason === 'customer_cancelled') return 'errors.topupCancelledByCustomer';
  if (reason === 'target_required' || reason === 'amount_required' || reason === 'update_for_shillings') {
    return 'errors.updateApp';
  }
  if (reason === 'idempotency_mismatch') return 'errors.startNewTopup';

  switch (code) {
    case 'functions/resource-exhausted':
      if (error?.details?.hardLocked) return 'errors.pinHardLocked';
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

  return fallbackKey ? genericErrorKey(error, fallbackKey) : callableErrorKey(error);
}

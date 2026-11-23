import type { TFunction } from 'i18next';
import { cooldownMessage } from './cooldownMessage';
import { logger } from './logger';
import { formatMoney } from './money';

/**
 * A failed call, said in the customer's language.
 *
 * The callables' messages are fixed English strings written for engineers
 * ("Insufficient balance", "Recipient not found"), so a Somali or Arabic
 * customer would read English and everyone would read developer wording.
 * Screens show `errorMessage(e, t, fallbackKey)` instead of `e.message`:
 * known refusals get their own translation, anything else the screen's own
 * fallback ("Payment failed") or a generic line. The original goes to the
 * logger, never to the screen.
 */
export interface ErrorText {
  key: string;
  params?: Record<string, string | number>;
}

// RNFirebase prints the code at the front of the message: "[functions/not-found] …".
const CODE_PREFIX = /^\[([a-z-]+\/[a-z-]+)\]\s*/i;

const FUNCTIONS_CODES = new Set([
  'aborted',
  'already-exists',
  'cancelled',
  'data-loss',
  'deadline-exceeded',
  'failed-precondition',
  'internal',
  'invalid-argument',
  'not-found',
  'out-of-range',
  'permission-denied',
  'resource-exhausted',
  'unauthenticated',
  'unavailable',
  'unimplemented',
  'unknown',
]);

/**
 * The error's Firebase code ("functions/not-found", "auth/too-many-requests").
 * Several services re-throw a plain `Error(error.message)`, which drops
 * `code` but keeps it at the front of the message, so it is read from there
 * too.
 */
export function errorCode(error: any): string | undefined {
  const code = error?.code;
  if (typeof code === 'string' && code.includes('/')) return code;
  if (typeof code === 'string' && FUNCTIONS_CODES.has(code)) return `functions/${code}`;
  const prefixed = typeof error?.message === 'string' ? CODE_PREFIX.exec(error.message) : null;
  return prefixed ? prefixed[1].toLowerCase() : undefined;
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

/** The server's English, for matching only. */
function serverText(error: any): string {
  return typeof error?.message === 'string' ? error.message.replace(CODE_PREFIX, '') : '';
}

/**
 * A wrong PIN is the one failure the customer fixes by typing again.
 * The callables word it "Invalid PIN", "Incorrect PIN" and "Wrong PIN".
 */
export function isWrongPin(error: any): boolean {
  return (
    errorCode(error) === 'functions/permission-denied' &&
    /\b(invalid|incorrect|wrong)(\s+agent)?\s+pin\b/i.test(serverText(error))
  );
}

const usd = (cents: unknown) => (typeof cents === 'number' ? formatMoney(cents, 'USD') : undefined);

/** Refusals keyed by the server's `details.reason`. */
function fromReason(error: any): ErrorText | null {
  const details = error?.details ?? {};
  switch (details.reason) {
    case 'pin_reset_cooldown':
    case 'phone_change_cooldown':
      // With `until` set, cooldownMessage says when; this is the fallback.
      return { key: 'errors.sendingPaused' };
    case 'recipient_is_merchant':
      return { key: 'payments.recipientIsBusiness' };
    case 'insufficient_balance':
      return { key: 'errors.insufficientBalance' };
    case 'weak_pin':
      return { key: 'auth.setupPin.weakPin' };
    case 'update_for_shillings':
    case 'target_required':
    case 'amount_required':
      return { key: 'errors.updateApp' };
    case 'idempotency_mismatch':
    case 'moved':
    case 'wrong_status':
      return { key: 'errors.changed' };
    case 'amount_out_of_range':
      if (typeof details.minCents === 'number' && typeof details.maxCents === 'number') {
        return {
          key: 'errors.amountRange',
          params: {
            min: formatMoney(details.minCents, details.currency),
            max: formatMoney(details.maxCents, details.currency),
          },
        };
      }
      return null;
    case 'off':
      return { key: 'errors.serviceOff' };
    case 'blocked':
      return { key: 'errors.pausedOnAccount' };
    case 'currency':
      return { key: 'errors.dollarsOnly' };
    case 'daily_count':
      return { key: 'errors.zaadDailyCount' };
    case 'daily_amount': {
      const amount = /top up (\S+) more/i.exec(serverText(error))?.[1];
      return amount ? { key: 'errors.zaadDailyAmount', params: { amount } } : { key: 'errors.zaadDailyCount' };
    }
    case 'too_late':
      return { key: 'errors.zaadTooLate' };
    case 'txn_id':
      return { key: 'errors.zaadTxnId' };
    case 'txn_id_used':
      return { key: 'errors.zaadTxnIdUsed' };
    case 'not_cancellable':
      return { key: 'errors.zaadNotCancellable' };
    case 'not_disputable':
      return { key: 'errors.zaadNotDisputable' };
    case 'no_account':
      return { key: 'errors.recipientNotFound' };
    case 'lookup_limit':
    case 'rate_limited':
      return { key: 'errors.tooMany' };
  }
  return null;
}

/** Refusals told apart by their (fixed, English) wording. */
function fromMessage(error: any, code: string | undefined): ErrorText | null {
  const message = serverText(error);
  const details = error?.details ?? {};

  if (code === 'functions/resource-exhausted') {
    if (/too many transactions/i.test(message)) return { key: 'errors.velocity' };
    if ((details.kind === 'daily' || details.kind === 'monthly') && typeof details.remaining === 'number') {
      return {
        key: details.kind === 'daily' ? 'errors.dailyLimit' : 'errors.monthlyLimit',
        params: { amount: usd(details.remaining)! },
      };
    }
  }

  if (code === 'functions/permission-denied') {
    if (/limit for a single transaction/i.test(message)) {
      const amount = /exceeds the (\$[\d,.]+)/i.exec(message)?.[1];
      return amount ? { key: 'errors.perTransactionLimit', params: { amount } } : { key: 'errors.overLimit' };
    }
    if (/^(this )?account is frozen/i.test(message)) return { key: 'errors.accountFrozen' };
    if (/^this account is closed/i.test(message)) return { key: 'errors.accountClosed' };
    if (/^that account is (closed|temporarily unavailable)/i.test(message)) {
      return { key: 'errors.recipientUnavailable' };
    }
  }

  if (/insufficient balance/i.test(message)) return { key: 'errors.insufficientBalance' };
  if (/pin not set/i.test(message)) return { key: 'errors.pinNotSet' };
  // setupPin's service drops `details`, so weak_pin is read from the words too.
  if (/pin is too easy to guess/i.test(message)) return { key: 'auth.setupPin.weakPin' };
  if (/^recipient not found/i.test(message)) return { key: 'errors.recipientNotFound' };
  if (/(cannot|can't) (send money to|pay) yourself/i.test(message)) return { key: 'errors.selfPayment' };
  if (/^(merchant not found|recipient is not a merchant)/i.test(message)) {
    return { key: 'errors.merchantUnavailable' };
  }
  if (/already being processed/i.test(message)) return { key: 'errors.inProgress' };
  // validateQRCode's `reason`.
  if (/^qr code (has expired|is \w+$)/i.test(message)) return { key: 'errors.qrNoLongerValid' };
  if (/update zapp pay/i.test(message)) return { key: 'errors.updateApp' };
  const minimum = /^minimum (?:cash-out|top-up) is (\S+)/i.exec(message)?.[1];
  if (minimum) return { key: 'errors.belowMinimum', params: { amount: minimum } };
  if (/too many top-up requests/i.test(message)) return { key: 'errors.tooMany' };
  if (/linked to another zapp account/i.test(message)) return { key: 'errors.numberTaken' };
  if (/link a different number/i.test(message)) return { key: 'errors.linkCooldown' };
  if (/link and activate your number first/i.test(message)) return { key: 'errors.linkNumberFirst' };
  if (code === 'functions/unavailable' && /(aren't|isn't|not) (open|available)/i.test(message)) {
    return { key: 'errors.serviceOff' };
  }
  if (/app.?check/i.test(message)) return { key: 'errors.appCheck' };
  return null;
}

/** Firebase Auth (sending and checking the SMS code). */
const AUTH_KEYS: Record<string, string> = {
  'auth/invalid-verification-code': 'errors.wrongCode',
  'auth/missing-verification-code': 'errors.wrongCode',
  'auth/code-expired': 'errors.codeExpired',
  'auth/session-expired': 'errors.codeExpired',
  'auth/too-many-requests': 'errors.tooManyCodes',
  'auth/quota-exceeded': 'errors.tooManyCodes',
  'auth/network-request-failed': 'errors.network',
  'auth/invalid-phone-number': 'errors.invalidPhone',
  'auth/missing-phone-number': 'errors.invalidPhone',
};

/**
 * Codes whose meaning does not depend on the screen. The rest
 * (failed-precondition, invalid-argument, not-found, internal …) say too
 * little on their own, so the screen's fallback is used for them.
 */
const CODE_KEYS: Record<string, string> = {
  'functions/unauthenticated': 'errors.sessionExpired',
  'functions/unavailable': 'errors.network',
  'functions/deadline-exceeded': 'errors.network',
  'functions/resource-exhausted': 'errors.tooMany',
  'firestore/unavailable': 'errors.network',
  ...AUTH_KEYS,
};

/**
 * The translation key (and its values) for a failed call. `fallbackKey` is
 * the screen's own failure line, used when nothing more specific is known.
 */
export function errorText(error: any, fallbackKey: string = 'errors.generic'): ErrorText {
  const code = errorCode(error);
  const details = error?.details ?? {};

  // The PIN lockout, from a callable or as auth.service's PinLockoutError.
  if (error?.hardLocked === true || details.hardLocked === true) return { key: 'pin.hardLocked' };
  const secondsLeft = Number(error?.secondsLeft ?? details.secondsLeft);
  if ((code === 'functions/resource-exhausted' || error?.name === 'PinLockoutError') && secondsLeft > 0) {
    return { key: 'pin.lockedOut', params: { seconds: secondsLeft } };
  }
  if (isWrongPin(error)) return { key: 'auth.pinLogin.invalidPin' };

  const specific = fromReason(error) ?? fromMessage(error, code);
  if (specific) return specific;

  if (code && CODE_KEYS[code]) return { key: CODE_KEYS[code] };
  if (!code && /network|offline|internet connection|timed out/i.test(serverText(error))) {
    return { key: 'errors.network' };
  }
  return { key: fallbackKey };
}

/**
 * What to show for a failed call. The pause after a PIN reset or a phone
 * change keeps its own wording (cooldownMessage), with the time it ends.
 */
export function errorMessage(error: any, t: TFunction, fallbackKey?: string): string {
  logger.warn('Call failed:', errorCode(error) ?? '', serverText(error) || error);
  const cooldown = cooldownMessage(error, t);
  if (cooldown) return cooldown;
  const { key, params } = errorText(error, fallbackKey);
  return t(key, params) as string;
}

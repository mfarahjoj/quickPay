import fs from 'fs';
import path from 'path';
import type { TFunction } from 'i18next';
import { asError, errorCode, errorMessage, errorText, isWrongPin } from '../errors';
import { logger } from '../logger';

jest.mock('../logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));

const en = require('../../i18n/locales/en.json');
const so = require('../../i18n/locales/so.json');
const ar = require('../../i18n/locales/ar.json');

/** A callable's HttpsError as RNFirebase hands it over. */
const callable = (code: string, message: string, details?: Record<string, unknown>) => ({
  code: `functions/${code}`,
  message: `[functions/${code}] ${message}`,
  details,
});

const key = (error: any, fallback?: string) => errorText(error, fallback).key;

const t = ((k: string, params?: Record<string, unknown>) =>
  params ? `${k} ${JSON.stringify(params)}` : k) as unknown as TFunction;

describe('errorCode', () => {
  it('reads the code from the error, or from the message a service re-threw', () => {
    expect(errorCode({ code: 'functions/not-found' })).toBe('functions/not-found');
    expect(errorCode({ code: 'not-found' })).toBe('functions/not-found');
    expect(errorCode(new Error('[functions/permission-denied] Invalid PIN'))).toBe('functions/permission-denied');
    expect(errorCode(new Error('[auth/too-many-requests] We have blocked all requests'))).toBe('auth/too-many-requests');
    expect(errorCode(new Error('Payment failed'))).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});

describe('asError', () => {
  it('re-throws a Firebase error as it is, so its details reach the screen', () => {
    const e = Object.assign(new Error('[functions/failed-precondition] Sending money is paused'), {
      code: 'functions/failed-precondition',
      details: { reason: 'pin_reset_cooldown', until: '2026-11-23T14:05:00.000Z', allowanceCents: 5000 },
    });
    expect(asError(e, 'Payment failed')).toBe(e);
    expect(errorMessage(asError(e, 'Payment failed'), t)).toMatch(/^payments\.cooldown /);
  });

  it('wraps anything else, keeping its code and details', () => {
    const wrapped = asError({ code: 'auth/too-many-requests', message: 'blocked', details: { a: 1 } }, 'Failed to send OTP');
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped).toMatchObject({ message: 'blocked', code: 'auth/too-many-requests', details: { a: 1 } });
    expect(key(wrapped)).toBe('errors.tooManyCodes');
    expect(asError('nope', 'Failed to sign out').message).toBe('Failed to sign out');
    expect(asError(undefined, 'Failed to sign out')).not.toHaveProperty('code');
  });
});

describe('isWrongPin', () => {
  it('matches each wording of a wrong PIN, and only as permission-denied', () => {
    expect(isWrongPin(callable('permission-denied', 'Invalid PIN'))).toBe(true);
    expect(isWrongPin(callable('permission-denied', 'Incorrect PIN.'))).toBe(true);
    expect(isWrongPin(callable('permission-denied', 'Wrong PIN'))).toBe(true);
    expect(isWrongPin(new Error('[functions/permission-denied] Invalid PIN'))).toBe(true);
    expect(isWrongPin(callable('invalid-argument', 'PIN is required'))).toBe(false);
    expect(isWrongPin(callable('permission-denied', 'Account is frozen'))).toBe(false);
  });
});

describe('errorText', () => {
  it('sends the customer back to the keypad for a wrong PIN', () => {
    expect(key(callable('permission-denied', 'Invalid PIN'), 'qr.confirm.paymentFailed')).toBe('auth.pinLogin.invalidPin');
  });

  it('explains the PIN lockout, from a callable or a PinLockoutError', () => {
    const hard = callable('resource-exhausted', 'Your PIN is locked after too many wrong attempts.', { hardLocked: true });
    expect(key(hard)).toBe('pin.hardLocked');
    expect(errorText(callable('resource-exhausted', 'Too many incorrect PIN attempts. Try again in 42 seconds.', { secondsLeft: 42 })))
      .toEqual({ key: 'pin.lockedOut', params: { seconds: 42 } });
    const lockout = Object.assign(new Error('locked'), { name: 'PinLockoutError', secondsLeft: 30, hardLocked: false });
    expect(errorText(lockout)).toEqual({ key: 'pin.lockedOut', params: { seconds: 30 } });
    expect(key(Object.assign(new Error('locked'), { name: 'PinLockoutError', hardLocked: true }))).toBe('pin.hardLocked');
  });

  it('reads the reason the server gives', () => {
    expect(key(callable('failed-precondition', 'This number belongs to a business.', { reason: 'recipient_is_merchant' })))
      .toBe('payments.recipientIsBusiness');
    expect(key(callable('invalid-argument', "That PIN is too easy to guess.", { reason: 'weak_pin' }))).toBe('auth.setupPin.weakPin');
    expect(key(callable('failed-precondition', 'Update the app', { reason: 'update_for_shillings' }))).toBe('errors.updateApp');
    expect(key(callable('unavailable', "Zaad top-ups through agents aren't open yet", { reason: 'off' }))).toBe('errors.serviceOff');
    expect(key(callable('already-exists', 'That Zaad transaction ID has already been used', { reason: 'txn_id_used' })))
      .toBe('errors.zaadTxnIdUsed');
  });

  it('puts the amounts of a range in their own currency', () => {
    expect(errorText(callable('invalid-argument', 'Top up between $1.00 and $500.00', {
      reason: 'amount_out_of_range', minCents: 100, maxCents: 50000,
    }))).toEqual({ key: 'errors.amountRange', params: { min: '$1.00', max: '$500.00' } });
    expect(errorText(callable('invalid-argument', 'Top up between …', {
      reason: 'amount_out_of_range', minCents: 10000, maxCents: 5000000, currency: 'SLS',
    }))).toEqual({ key: 'errors.amountRange', params: { min: '10,000 SLSH', max: '5,000,000 SLSH' } });
    expect(errorText(callable('resource-exhausted', 'You can top up $40.00 more by Zaad today', { reason: 'daily_amount' })))
      .toEqual({ key: 'errors.zaadDailyAmount', params: { amount: '$40.00' } });
  });

  it('tells the money refusals apart', () => {
    expect(key(callable('failed-precondition', 'Insufficient balance'))).toBe('errors.insufficientBalance');
    expect(key(callable('resource-exhausted', 'Too many transactions. Limit: 20 per hour.'))).toBe('errors.velocity');
    expect(errorText(callable('resource-exhausted', 'Daily limit reached. You can send $12.50 more this day (limit $500.00).', {
      kind: 'daily', remaining: 1250, limit: 50000, used: 48750,
    }))).toEqual({ key: 'errors.dailyLimit', params: { amount: '$12.50' } });
    expect(errorText(callable('resource-exhausted', 'Monthly limit reached.', { kind: 'monthly', remaining: 0 })))
      .toEqual({ key: 'errors.monthlyLimit', params: { amount: '$0.00' } });
    expect(errorText(callable('permission-denied', 'This exceeds the $1,000.00 limit for a single transaction.')))
      .toEqual({ key: 'errors.perTransactionLimit', params: { amount: '$1,000.00' } });
    expect(errorText(callable('invalid-argument', 'Minimum cash-out is $1.00')))
      .toEqual({ key: 'errors.belowMinimum', params: { amount: '$1.00' } });
    expect(key(callable('aborted', 'This payment is already being processed. Check your history before retrying.')))
      .toBe('errors.inProgress');
  });

  it("reads the scanner's refusal reasons", () => {
    const reason = (r: string) => key({ message: r }, 'qr.scan.invalidQr');
    expect(reason('QR code has expired')).toBe('errors.qrNoLongerValid');
    expect(reason('QR code is used')).toBe('errors.qrNoLongerValid');
    expect(reason('This shop is charging in shillings. Update Zapp Pay to pay it.')).toBe('errors.updateApp');
    expect(reason('Cannot pay yourself')).toBe('errors.selfPayment');
    expect(reason('QR code not found')).toBe('qr.scan.invalidQr');
    expect(reason('Invalid QR code format')).toBe('qr.scan.invalidQr');
  });

  it('says whose account is the problem', () => {
    expect(key(callable('permission-denied', 'This account is frozen. Please contact support.'))).toBe('errors.accountFrozen');
    expect(key(callable('permission-denied', 'Account is frozen'))).toBe('errors.accountFrozen');
    expect(key(callable('permission-denied', 'This account is closed.'))).toBe('errors.accountClosed');
    expect(key(callable('permission-denied', 'That account is closed and cannot be paid.'))).toBe('errors.recipientUnavailable');
    expect(key(callable('permission-denied', 'That account is temporarily unavailable.'))).toBe('errors.recipientUnavailable');
    expect(key(callable('not-found', 'Recipient not found'))).toBe('errors.recipientNotFound');
    expect(key(callable('permission-denied', 'Cannot send money to yourself'))).toBe('errors.selfPayment');
    expect(key(callable('permission-denied', 'Cannot pay yourself'))).toBe('errors.selfPayment');
    expect(key(callable('not-found', 'Merchant not found'))).toBe('errors.merchantUnavailable');
  });

  it('still recognises an error a service re-threw without its code', () => {
    expect(key(new Error('[functions/failed-precondition] Insufficient balance'))).toBe('errors.insufficientBalance');
    expect(key(new Error('[functions/unauthenticated] Unauthenticated'))).toBe('errors.sessionExpired');
    expect(key(new Error("[functions/invalid-argument] That PIN is too easy to guess. Choose one that isn't a pattern.")))
      .toBe('auth.setupPin.weakPin');
  });

  it('maps the SMS sign-in failures', () => {
    expect(key(new Error('[auth/invalid-verification-code] The SMS verification code is invalid.'))).toBe('errors.wrongCode');
    expect(key({ code: 'auth/session-expired', message: 'expired' })).toBe('errors.codeExpired');
    expect(key({ code: 'auth/too-many-requests', message: 'blocked' })).toBe('errors.tooManyCodes');
    expect(key({ code: 'auth/network-request-failed', message: 'network' })).toBe('errors.network');
    expect(key({ code: 'auth/invalid-phone-number', message: 'bad' })).toBe('errors.invalidPhone');
  });

  it('falls back on the code, then on the screen, then on a generic line', () => {
    expect(key(callable('unauthenticated', 'User must be authenticated'))).toBe('errors.sessionExpired');
    expect(key(callable('unauthenticated', 'App Check token is invalid.'))).toBe('errors.appCheck');
    expect(key(callable('unavailable', 'UNAVAILABLE'))).toBe('errors.network');
    expect(key(callable('unavailable', "Top-ups by this method aren't open yet"))).toBe('errors.serviceOff');
    expect(key(callable('resource-exhausted', 'Slow down'))).toBe('errors.tooMany');
    expect(key(new Error('Network request failed'))).toBe('errors.network');
    expect(key(callable('failed-precondition', 'Some new refusal'), 'payments.transferFailed')).toBe('payments.transferFailed');
    expect(key(callable('internal', 'Failed to process payment'), 'qr.confirm.paymentFailed')).toBe('qr.confirm.paymentFailed');
    expect(key(new Error('Cash-out failed'))).toBe('errors.generic');
    expect(key(undefined)).toBe('errors.generic');
  });
});

describe('errorMessage', () => {
  it('says when sending resumes after a PIN reset', () => {
    const e = callable('failed-precondition', 'Sending money is paused for a while after a PIN reset.', {
      reason: 'pin_reset_cooldown', until: '2026-11-23T14:05:00.000Z', allowanceCents: 5000,
    });
    expect(errorMessage(e, t, 'qr.confirm.paymentFailed')).toMatch(/^payments\.cooldown /);
    // Without a time, the generic pause.
    expect(errorMessage(callable('failed-precondition', 'paused', { reason: 'pin_reset_cooldown' }), t)).toBe('errors.sendingPaused');
  });

  it('translates with the values, and logs the server text instead of showing it', () => {
    const e = callable('resource-exhausted', 'Daily limit reached.', { kind: 'daily', remaining: 1250 });
    expect(errorMessage(e, t)).toBe('errors.dailyLimit {"amount":"$12.50"}');
    expect(logger.warn).toHaveBeenCalledWith('Call failed:', 'functions/resource-exhausted', 'Daily limit reached.');
    expect(errorMessage(callable('internal', 'boom'), t, 'payments.transferFailed')).toBe('payments.transferFailed');
  });
});

describe('translations', () => {
  // Every key the helper can return, read from its source.
  const source = fs.readFileSync(path.join(__dirname, '../errors.ts'), 'utf8');
  const keys = Array.from(new Set(Array.from(source.matchAll(/'((?:errors|pin|auth|payments)\.[A-Za-z.]+)'/g), (m) => m[1])));

  it('finds the keys', () => {
    expect(keys.length).toBeGreaterThan(30);
  });

  it.each(keys)('%s is in en, so and ar with the same values', (k) => {
    const placeholders = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort();
    for (const locale of [en, so, ar]) {
      expect(typeof locale[k]).toBe('string');
      expect(locale[k].length).toBeGreaterThan(0);
      expect(placeholders(locale[k])).toEqual(placeholders(en[k]));
    }
  });
});

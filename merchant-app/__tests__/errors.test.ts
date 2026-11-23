import fs from 'fs';
import path from 'path';
import { callableErrorKey, errorCode, genericErrorKey, isWrongPin, pinActionErrorKey } from '../src/utils/errors';

const en = require('../src/i18n/locales/en.json');
const so = require('../src/i18n/locales/so.json');
const ar = require('../src/i18n/locales/ar.json');

/** A callable's HttpsError as RNFirebase hands it over. */
const callable = (code: string, message: string, details?: Record<string, unknown>) => ({
  code: `functions/${code}`,
  message: `[functions/${code}] ${message}`,
  details,
});

describe('errorCode', () => {
  it('reads the code from the error, or from the message a service re-threw', () => {
    expect(errorCode({ code: 'functions/not-found' })).toBe('functions/not-found');
    expect(errorCode(new Error('[functions/permission-denied] Invalid PIN'))).toBe('functions/permission-denied');
    expect(errorCode(new Error('[auth/too-many-requests] blocked'))).toBe('auth/too-many-requests');
    expect(errorCode(new Error('Failed to scan token'))).toBeUndefined();
  });
});

describe('callableErrorKey', () => {
  it('maps the callable codes to the payment wording', () => {
    expect(callableErrorKey(callable('permission-denied', 'Not a merchant'))).toBe('qr.errors.permissionDenied');
    expect(callableErrorKey(callable('unavailable', 'UNAVAILABLE'))).toBe('qr.errors.unavailable');
    expect(callableErrorKey(callable('resource-exhausted', 'Slow down'))).toBe('qr.errors.tooMany');
    expect(callableErrorKey(callable('internal', 'boom'))).toBe('qr.errors.generic');
  });

  it('recognises App Check and a re-thrown error', () => {
    expect(callableErrorKey({ code: 'functions/foo', message: 'App Check token invalid' })).toBe('qr.errors.appCheck');
    expect(callableErrorKey(new Error('[functions/not-found] Merchant not found'))).toBe('qr.errors.notFound');
    expect(callableErrorKey(new Error('Failed to scan token'))).toBe('qr.errors.generic');
  });
});

describe('isWrongPin', () => {
  it('matches each wording, re-thrown or not, and only as permission-denied', () => {
    expect(isWrongPin(callable('permission-denied', 'Invalid PIN'))).toBe(true);
    expect(isWrongPin(callable('permission-denied', 'Invalid agent PIN'))).toBe(true);
    expect(isWrongPin(callable('permission-denied', 'Incorrect PIN'))).toBe(true);
    expect(isWrongPin(new Error('[functions/permission-denied] Invalid PIN'))).toBe(true);
    expect(isWrongPin(callable('invalid-argument', 'PIN is required'))).toBe(false);
    expect(isWrongPin(callable('permission-denied', 'Account is frozen'))).toBe(false);
  });
});

describe('pinActionErrorKey', () => {
  it('tells apart failures that share a code', () => {
    expect(pinActionErrorKey(callable('permission-denied', 'Invalid PIN'))).toBe('errors.wrongPin');
    expect(pinActionErrorKey(callable('permission-denied', 'You cannot confirm your own top-up'))).toBe('errors.ownTopup');
    expect(pinActionErrorKey(callable('permission-denied', 'Account is frozen'))).toBe('errors.accountRestricted');
    expect(pinActionErrorKey(callable('failed-precondition', 'Code expired'))).toBe('errors.codeExpired');
    expect(pinActionErrorKey(callable('failed-precondition', 'Code already used'))).toBe('errors.codeUsed');
    expect(pinActionErrorKey(callable('failed-precondition', 'Insufficient float'))).toBe('errors.insufficientFloat');
    expect(pinActionErrorKey(callable('failed-precondition', 'Insufficient balance'))).toBe('errors.insufficientBalance');
    expect(pinActionErrorKey(callable('resource-exhausted', 'Too many PIN attempts'))).toBe('errors.pinLocked');
    expect(pinActionErrorKey(callable('resource-exhausted', 'Locked', { hardLocked: true }))).toBe('errors.pinHardLocked');
    expect(pinActionErrorKey(callable('not-found', 'Code not found'))).toBe('errors.codeNotFound');
  });

  it('reads the reason the server gives', () => {
    expect(pinActionErrorKey(callable('failed-precondition', 'paused', { reason: 'pin_reset_cooldown' }))).toBe('errors.sendingPaused');
    expect(pinActionErrorKey(callable('failed-precondition', 'changed', { reason: 'amount_mismatch' }))).toBe('errors.topupAmountChanged');
    expect(pinActionErrorKey(callable('failed-precondition', 'update', { reason: 'update_for_shillings' }))).toBe('errors.updateApp');
  });

  it("uses the screen's fallback for anything unrecognised", () => {
    expect(pinActionErrorKey(callable('internal', 'boom'))).toBe('qr.errors.generic');
    expect(pinActionErrorKey(callable('failed-precondition', 'Something new'), 'transactions.refund.failed'))
      .toBe('transactions.refund.failed');
    expect(pinActionErrorKey(callable('unavailable', 'UNAVAILABLE'), 'transactions.refund.failed')).toBe('qr.errors.unavailable');
    // A wrong PIN still wins over the fallback.
    expect(pinActionErrorKey(callable('permission-denied', 'Invalid PIN'), 'transactions.refund.failed')).toBe('errors.wrongPin');
  });
});

describe('genericErrorKey', () => {
  it('keeps connection, sign-in and rate-limit failures', () => {
    expect(genericErrorKey(callable('unauthenticated', 'Sign in'), 'scan.scanFailedMessage')).toBe('qr.errors.unauthenticated');
    expect(genericErrorKey(callable('deadline-exceeded', 'timeout'), 'scan.scanFailedMessage')).toBe('qr.errors.unavailable');
    expect(genericErrorKey(callable('resource-exhausted', 'Slow down'), 'scan.scanFailedMessage')).toBe('qr.errors.tooMany');
    expect(genericErrorKey(callable('unauthenticated', 'App Check failed'), 'scan.scanFailedMessage')).toBe('qr.errors.appCheck');
    expect(genericErrorKey(new Error('Network request failed'), 'scan.scanFailedMessage')).toBe('qr.errors.unavailable');
  });

  it('maps the SMS sign-in failures, also when the auth service re-threw them', () => {
    expect(genericErrorKey(new Error('[auth/invalid-verification-code] invalid'), 'qr.errors.generic')).toBe('errors.smsCodeWrong');
    expect(genericErrorKey({ code: 'auth/session-expired', message: 'expired' }, 'qr.errors.generic')).toBe('errors.smsCodeExpired');
    expect(genericErrorKey(new Error('[auth/too-many-requests] blocked'), 'qr.errors.generic')).toBe('errors.tooManyCodes');
    expect(genericErrorKey({ code: 'auth/invalid-phone-number', message: 'bad' }, 'qr.errors.generic')).toBe('errors.invalidPhone');
    expect(genericErrorKey({ code: 'auth/network-request-failed', message: 'net' }, 'qr.errors.generic')).toBe('qr.errors.unavailable');
  });

  it("does not use the payment wording: anything else is the screen's own line", () => {
    expect(genericErrorKey(callable('permission-denied', 'Not allowed'), 'auth.onboarding.role.couldNotFinishMessage'))
      .toBe('auth.onboarding.role.couldNotFinishMessage');
    expect(genericErrorKey(callable('not-found', 'User not found'), 'common.customerNotFound')).toBe('common.customerNotFound');
    expect(genericErrorKey(new Error('Failed to scan token'), 'scan.scanFailedMessage')).toBe('scan.scanFailedMessage');
  });
});

describe('translations', () => {
  // Every key the helper can return, read from its source.
  const source = fs.readFileSync(path.join(__dirname, '../src/utils/errors.ts'), 'utf8');
  const keys = Array.from(new Set(Array.from(source.matchAll(/'((?:errors|qr\.errors)\.[A-Za-z.]+)'/g), (m) => m[1])));

  it('finds the keys', () => {
    expect(keys.length).toBeGreaterThan(25);
  });

  it.each(keys)('%s is in en, so and ar', (k) => {
    const placeholders = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort();
    for (const locale of [en, so, ar]) {
      expect(typeof locale[k]).toBe('string');
      expect(locale[k].length).toBeGreaterThan(0);
      expect(placeholders(locale[k])).toEqual(placeholders(en[k]));
    }
  });
});

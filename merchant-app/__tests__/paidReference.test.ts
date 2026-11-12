import { priorPaymentFromError, shouldCheckPaidReference } from '../src/utils/paidReference';

describe('paidReference', () => {
  describe('shouldCheckPaidReference', () => {
    it.each([
      ['Invoice No 37841', 'invoice', true],
      ['Bill No 8841', 'bill', true],
      ['Rasiid No 7731', 'rasiid', true],
      ['KOT No 65', 'kot', false],
      ['Table 12', 'table', false],
    ])('scanned "%s" (%s) → %s', (reference, kind, expected) => {
      expect(shouldCheckPaidReference(reference, kind)).toBe(expected);
    });

    it.each([
      ['37841', true],
      ['INV-0098', true],
      ['Invoice 2026/0098', true],
      ['Table 4', false],
      ['Order #12', false],
      ['Ahmed', false],
      ['   ', false],
    ])('typed "%s" → %s', (reference, expected) => {
      expect(shouldCheckPaidReference(reference, null)).toBe(expected);
    });
  });

  describe('priorPaymentFromError', () => {
    const priorPayment = {
      reference: 'Invoice No 37841',
      receiptNumber: 'ZP-7M3N-9QX2',
      amount: 256,
      currency: 'USD',
      paidByName: 'Ahmed Ali',
      paidAt: '2026-11-12T11:37:28.000Z',
      count: 1,
    };

    it('reads the earlier payment off the refusal, however the code is spelled', () => {
      expect(priorPaymentFromError({ code: 'functions/already-exists', details: { priorPayment } })).toEqual(
        priorPayment
      );
      expect(priorPaymentFromError({ code: 'already-exists', details: { priorPayment } })).toEqual(priorPayment);
    });

    it('ignores every other error', () => {
      expect(priorPaymentFromError({ code: 'functions/invalid-argument', details: { priorPayment } })).toBeNull();
      expect(priorPaymentFromError(new Error('offline'))).toBeNull();
      expect(priorPaymentFromError({ code: 'functions/already-exists' })).toBeNull();
    });
  });
});

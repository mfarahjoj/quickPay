import {
  buildRows,
  findIdentifiers,
  findTotalCents,
  identifierToReference,
  parseReceipt,
  OcrLine,
} from '../src/utils/receiptParser';

// The Kofia Cafe receipt, as an OCR engine returns it: left and right columns
// arrive as separate lines, in reading order by block rather than by row.
const line = (text: string, left: number, top: number): OcrLine => ({
  text,
  frame: { left, top, width: text.length * 12, height: 28 },
});

const KOFIA: OcrLine[] = [
  line('KOFIA CAFE', 560, 300),
  line('Ibrahim Dheere Center Building, Hargeisa', 410, 345),
  line('Telephone No: +252 574199', 515, 385),
  line('Whatsapp No: +252 6', 565, 430),
  line('Zaad: 518101', 625, 480),
  line('Edahab: 751226', 605, 520),
  line('Premier Wallet: 0', 600, 565),
  line('TAX INVOICE', 530, 610),
  line('ZAAD/EDAHAB/PREMIER', 400, 690),
  line('TABLE ORDER', 535, 760),
  line('KOT No.: 65', 595, 830),
  // left column block
  line('Invoice No.:37841', 310, 885),
  line('Cashier:ABDIQANI', 305, 945),
  line('Item Name', 300, 1020),
  line('Cappuccino Medium', 295, 1110),
  line('Total Amount:', 290, 1195),
  line('TAX: 2.50 %', 288, 1255),
  line('Total with Tax:', 280, 1360),
  line('Somaliland Shillings', 275, 1425),
  line('Received through ZaadSLS', 272, 1490),
  line('Waiter: Rithwaan mustafe', 268, 1550),
  line('No. of Items: 1', 270, 1625),
  // right column block
  line('Date: 22/10/26', 915, 895),
  line('Time: 2:37:28 PM', 865, 955),
  line('Qty Price AMT', 830, 1035),
  line('1 2.50 2.50', 865, 1120),
  line('2.50', 1080, 1205),
  line('.06', 1110, 1270),
  line('2.56', 1075, 1370),
  line('30,720.00', 975, 1435),
  line('30,720.00', 975, 1500),
  line('Thank you come again', 400, 1800),
];

describe('receiptParser', () => {
  describe('Kofia Cafe receipt', () => {
    const parsed = parseReceipt(KOFIA);

    it('rebuilds printed rows from separate columns', () => {
      expect(parsed.rows).toContain('Total with Tax: 2.56');
      expect(parsed.rows).toContain('Invoice No.:37841 Date: 22/10/26');
    });

    it('reads the dollar total with tax, not the subtotal or the shillings', () => {
      expect(parsed.amountCents).toBe(256);
    });

    it('offers the invoice number first, then the KOT number', () => {
      expect(parsed.identifiers).toEqual([
        { kind: 'invoice', label: 'Invoice No', value: '37841' },
        { kind: 'kot', label: 'KOT No', value: '65' },
      ]);
    });

    it('never offers a phone or wallet number as the identifier', () => {
      const values = parsed.identifiers.map((i) => i.value);
      expect(values).not.toContain('518101');
      expect(values).not.toContain('751226');
      expect(values.some((v) => v.includes('252'))).toBe(false);
    });

    it("puts the merchant's remembered kind first", () => {
      const again = parseReceipt(KOFIA, 'kot');
      expect(again.identifiers[0]).toEqual({ kind: 'kot', label: 'KOT No', value: '65' });
    });

    it('builds a reference the customer will recognise', () => {
      expect(identifierToReference(parsed.identifiers[0])).toBe('Invoice No 37841');
    });
  });

  describe('rows', () => {
    it('falls back to one row per line when the engine gives no positions', () => {
      expect(buildRows([{ text: ' Total:  4.00 ' }, { text: '' }, { text: 'Bill # 12' }])).toEqual([
        'Total: 4.00',
        'Bill # 12',
      ]);
    });
  });

  describe('identifiers', () => {
    it.each([
      ['Receipt #: A-10293', 'receipt', 'A-10293'],
      ['Bill No 8841', 'bill', '8841'],
      ['ORDER: 2026/0098', 'order', '2026/0098'],
      ['Ref. 55120', 'reference', '55120'],
      ['Txn ID: 9F3K21', 'transaction', '9F3K21'],
      ['Check 204', 'check', '204'],
    ])('reads "%s"', (row, kind, value) => {
      expect(findIdentifiers([row])[0]).toMatchObject({ kind, value });
    });

    it('keeps a label it has never seen, as long as it is numbered', () => {
      expect(findIdentifiers(['Rasiid No: 7731'])[0]).toEqual({
        kind: 'rasiid',
        label: 'Rasiid No',
        value: '7731',
      });
    });

    it('ignores a label with no number after it', () => {
      expect(findIdentifiers(['TAX INVOICE', 'Order Date: 22/10/26'])).toEqual([]);
    });

    it('does not repeat the same number', () => {
      expect(findIdentifiers(['Invoice No: 12', 'Invoice No: 12'])).toHaveLength(1);
    });
  });

  describe('total', () => {
    it('prefers the final total over a plain total', () => {
      expect(findTotalCents(['Total: 10.00', 'VAT 5%: 0.50', 'Grand Total: 10.50'])).toBe(1050);
    });

    it('takes the last plain total when no final total is labelled', () => {
      expect(findTotalCents(['Sub Total: 9.00', 'Total 9.45'])).toBe(945);
    });

    it('reads a figure printed on the row below its label', () => {
      expect(findTotalCents(['Amount Due', '$12.00'])).toBe(1200);
    });

    it('accepts a whole-dollar total only when a $ leads it', () => {
      expect(findTotalCents(['Total $5'])).toBe(500);
      expect(findTotalCents(['Total 5'])).toBeNull();
    });

    it('returns nothing for a shilling-only receipt', () => {
      expect(findTotalCents(['Total SLSH 30,720.00', 'Total 30,720.00'])).toBeNull();
    });

    it('does not mistake cash tendered or change for the total', () => {
      expect(findTotalCents(['Total: 7.25', 'Cash: 10.00', 'Change: 2.75'])).toBe(725);
    });

    it('returns nothing when there is no total row', () => {
      expect(findTotalCents(['Cappuccino 2.50', 'Thank you'])).toBeNull();
    });
  });
});

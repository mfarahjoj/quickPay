import { computePaymentFee, computeCommission } from "../config/rates";

describe("computePaymentFee", () => {
  it("takes 1% of the amount, rounded to whole cents", () => {
    expect(computePaymentFee(4500, 0.01)).toBe(45); // $45.00 -> $0.45
    expect(computePaymentFee(10000, 0.01)).toBe(100); // $100.00 -> $1.00
  });

  it("rounds to the nearest cent", () => {
    expect(computePaymentFee(12345, 0.01)).toBe(123); // 123.45 -> 123
    expect(computePaymentFee(12355, 0.01)).toBe(124); // 123.55 -> 124
  });

  it("returns 0 when the fee rounds below a cent", () => {
    expect(computePaymentFee(40, 0.01)).toBe(0); // 0.4c -> 0
  });

  it("never exceeds the amount and is never negative", () => {
    expect(computePaymentFee(100, 2)).toBe(100);
    expect(computePaymentFee(100, -1)).toBe(0);
  });
});

describe("computeCommission", () => {
  it("takes 2% of the top-up, rounded to whole cents", () => {
    expect(computeCommission(2500, 0.02)).toBe(50); // $25.00 -> $0.50
    expect(computeCommission(6000, 0.02)).toBe(120); // $60.00 -> $1.20
  });

  it("is never negative", () => {
    expect(computeCommission(2500, -0.02)).toBe(0);
  });
});

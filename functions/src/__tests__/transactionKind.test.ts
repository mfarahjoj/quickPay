import { kindOf } from "../utils/transactionKind";

describe("kindOf", () => {
  it("keeps a stored kind", () => {
    expect(kindOf({ type: "payment", kind: "p2p", journalEntryId: "qrpay_x" })).toBe("p2p");
  });

  it.each([
    ["qrpay_q1", "payment", "merchant_payment"],
    ["custqr_r1", "payment", "merchant_payment"],
    ["paymerchant_u_k", "payment", "merchant_payment"],
    ["apicharge_c1", "payment", "online_payment"],
    ["p2p_t1", "payment", "p2p"],
    ["payroll_t1", "payment", "payroll"],
    ["agenttopup_r1", "topup", "cash_in"],
    ["manualtopup_t1", "topup", "cash_in"],
    ["cashouthold_c1", "withdrawal", "cash_out"],
    ["cashout_c1", "withdrawal", "cash_out"],
    ["payout_hold_p1", "withdrawal", "payout"],
    ["refund_pay-1", "refund", "refund"],
    ["refund_apicharge_c1_1", "refund", "refund"],
    ["adjustment_a1", "adjustment", "adjustment"],
    ["referral_u1", "referral", "referral"],
    ["float_issue_f1", "topup", "float"],
    ["float_withdraw_f1", "withdrawal", "float"],
  ])("reads %s (%s) as %s", (journalEntryId, type, kind) => {
    expect(kindOf({ type: type as any, journalEntryId })).toBe(kind);
  });

  it("falls back on the row type when there is no entry", () => {
    expect(kindOf({ type: "topup" })).toBe("cash_in");
    expect(kindOf({ type: "withdrawal" })).toBe("cash_out");
    expect(kindOf({ type: "payment" })).toBe("merchant_payment");
    expect(kindOf({ type: "payment", apiChargeId: "c1" })).toBe("online_payment");
  });
});

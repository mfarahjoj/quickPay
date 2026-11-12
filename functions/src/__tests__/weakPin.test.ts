import { isWeakPin } from "../utils/weakPin";

/** ONBOARDING_SECURITY_REVIEW.md B1: the server refuses easy PINs. */
describe("isWeakPin", () => {
  it.each([
    "123456", "000000", "999999", "121212", "123123", "654321",
    "345678", "876543", "789012", "198512", "121985", "200501", "041940",
  ])("refuses %s", (pin) => expect(isWeakPin(pin)).toBe(true));

  it.each(["482915", "730264", "581937", "204816"])("accepts %s", (pin) =>
    expect(isWeakPin(pin)).toBe(false)
  );

  it("refuses anything that isn't six digits", () => {
    expect(isWeakPin("48291")).toBe(true);
    expect(isWeakPin("48291a")).toBe(true);
  });
});

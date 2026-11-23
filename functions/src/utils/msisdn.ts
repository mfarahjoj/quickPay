/**
 * Somaliland and Somalia mobile numbers as E.164 (`+252` and nine digits),
 * from the ways people and SMS write them: `634123456`, `0634123456`,
 * `252634123456`, `00252634123456`, `+252 63 412 3456`. Null otherwise.
 */
export function normaliseSomaliMsisdn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^0-9]/g, "");
  if (digits.startsWith("00252")) digits = digits.slice(5);
  else if (digits.startsWith("252") && digits.length === 12) digits = digits.slice(3);
  if (digits.startsWith("0") && digits.length === 10) digits = digits.slice(1);
  return /^[1-9]\d{8}$/.test(digits) ? `+252${digits}` : null;
}

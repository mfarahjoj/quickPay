import { https } from "firebase-functions/v2";

/**
 * PINs too easy to guess (ONBOARDING_SECURITY_REVIEW.md B1).
 *
 * NIST SP 800-63B asks verifiers to refuse commonly used secrets. Checking
 * only in the app left any other client free to set 123456. This is the
 * authority; the apps' isWeakPin copies the same rules so people hear about
 * it before they submit.
 *
 * Refused:
 * - the most common 6-digit PINs from leaked-PIN studies;
 * - one digit six times (000000);
 * - a straight run up or down, wrapping past 9 (123456, 987654, 789012);
 * - a repeated pair or triple (121212, 123123);
 * - a year from 1940 to 2010 at the start or end (198512, 041987), the
 *   birth years people reach for.
 */

const COMMON = new Set([
  "123456", "654321", "123123", "121212", "112233", "123321", "159753",
  "147258", "102030", "789456", "112211", "159357", "147852", "456789",
  "987654", "789789", "456456", "100200", "007007", "147369", "258369",
  "101101", "123654", "321321", "998877", "778899", "135790", "246810",
  "112112", "110110", "520520", "131313", "696969", "252525", "202020",
  "101010", "010203", "098765", "111222", "121314", "456123", "741852",
  "963852", "852456", "142536", "142857", "314159", "000123", "123000",
]);

const UP = "0123456789012345";
const DOWN = "9876543210987654";

export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  if (COMMON.has(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if (UP.includes(pin) || DOWN.includes(pin)) return true;
  if (/^(\d\d)\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)) return true;
  const isYear = (s: string) => {
    const y = Number(s);
    return y >= 1940 && y <= 2010;
  };
  if (isYear(pin.slice(0, 4)) || isYear(pin.slice(2))) return true;
  return false;
}

/** Refuse a weak new PIN with a reason the apps translate. */
export function assertStrongPin(pin: string): void {
  if (isWeakPin(pin)) {
    throw new https.HttpsError(
      "invalid-argument",
      "That PIN is too easy to guess. Choose one that isn't a pattern, a repeat or a year.",
      { reason: "weak_pin" }
    );
  }
}

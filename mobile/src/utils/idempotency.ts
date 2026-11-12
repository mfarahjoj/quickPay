/**
 * Keys that let the server recognise a retry.
 *
 * A payment attempt mints one key and keeps it for as long as the customer is
 * attempting that payment, including across "Try again" after a failure. The
 * server derives the journal entry ID from it, so a retry of a payment that
 * actually succeeded returns the original receipt instead of charging again.
 *
 * Mint a new key only when the customer starts a genuinely new payment — a
 * different amount, or backing out and starting over. Reusing a key across two
 * intended payments would make the second one silently return the first.
 */

/**
 * Time-ordered and random: the timestamp makes keys from one device sort and
 * read sensibly in support, the random half makes collisions irrelevant.
 * Matches the server's `[A-Za-z0-9_-]{8,64}` rule.
 */
export function newIdempotencyKey(): string {
  const time = Date.now().toString(36);
  const random = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(36)
      .padStart(6, '0'),
  ).join('');
  return `${time}-${random}`;
}

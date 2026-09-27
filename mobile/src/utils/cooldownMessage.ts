import type { TFunction } from 'i18next';

/** "Sat 14:05" in the phone's own format. */
export function formatUntil(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * The customer's explanation when a payment is refused because their PIN was
 * reset recently, or null for any other error. The server's own text is
 * English; this says when sending resumes and what can still be spent.
 */
export function cooldownMessage(error: any, t: TFunction): string | null {
  const details = error?.details;
  if (details?.reason !== 'pin_reset_cooldown' || !details.until) return null;
  return t('payments.cooldown', {
    time: formatUntil(details.until),
    amount: `$${((details.allowanceCents ?? 0) / 100).toFixed(2)}`,
  });
}

/** Days the console allows for "Sign out after this long unused" (config/rates). */
export const IDLE_DAYS_DEFAULT = 30;
const IDLE_DAYS_MIN = 7;
const IDLE_DAYS_MAX = 180;

/**
 * The idle limit in milliseconds from config/app_client's sessionIdleDays:
 * the default when it's missing or outside what the console allows.
 */
export function idleLimitMs(days: unknown): number {
  const d =
    Number.isInteger(days) && (days as number) >= IDLE_DAYS_MIN && (days as number) <= IDLE_DAYS_MAX
      ? (days as number)
      : IDLE_DAYS_DEFAULT;
  return d * 24 * 60 * 60 * 1000;
}

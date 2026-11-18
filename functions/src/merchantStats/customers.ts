/**
 * Reading a shop's customer records: who is a regular, and which regulars
 * have stopped coming. Pure, so the dashboard and the insights engine agree.
 */

import { daysBetween } from "./time";
import { CustomerStats, StatsCurrency } from "./types";

/** At least this many visit days makes a customer a regular. */
export const REGULAR_MIN_VISIT_DAYS = 3;
/** A regular is lapsed after max(this, 2 × their usual gap) days away. */
export const LAPSED_MIN_DAYS = 14;

export function daysSinceLastVisit(c: Pick<CustomerStats, "lastSeenDay">, today: string): number {
  return Math.max(0, daysBetween(c.lastSeenDay, today));
}

/** Days away after which this customer counts as gone quiet. */
export function lapseThresholdDays(c: Pick<CustomerStats, "usualGapDays">): number {
  return Math.max(LAPSED_MIN_DAYS, Math.ceil(2 * (c.usualGapDays ?? 0)));
}

export function isRegular(c: Pick<CustomerStats, "visitDays">): boolean {
  return c.visitDays >= REGULAR_MIN_VISIT_DAYS;
}

export function isLapsedRegular(c: CustomerStats, today: string): boolean {
  return isRegular(c) && daysSinceLastVisit(c, today) > lapseThresholdDays(c);
}

/**
 * What a customer typically spends at the shop in 30 days, per currency:
 * spend per visit day, times visit days per 30 days at their usual gap.
 * What the shop stands to win back.
 */
export function monthlyValue(c: CustomerStats, currency: StatsCurrency): number {
  const spend = c.spend?.[currency] ?? 0;
  if (spend <= 0 || c.visitDays <= 0) return 0;
  const perVisitDay = spend / c.visitDays;
  const gap = Math.max(1, c.usualGapDays ?? 30);
  return Math.round(perVisitDay * Math.min(30, 30 / gap));
}

/** Lapsed regulars, most valuable first (dollars, then shillings). */
export function lapsedRegulars(customers: CustomerStats[], today: string): CustomerStats[] {
  return customers
    .filter((c) => isLapsedRegular(c, today))
    .sort((a, b) => monthlyValue(b, "USD") - monthlyValue(a, "USD") || monthlyValue(b, "SLS") - monthlyValue(a, "SLS"));
}

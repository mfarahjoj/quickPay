/**
 * Phone alerts for the urgent Zapp Business insights (MERCHANT_INSIGHTS.md,
 * Phase 2). The dashboard shows these cards only while it's open; this
 * hourly check pushes them to the shop's phone, so a silent till or a dead
 * counter display is noticed when nobody is watching a computer.
 *
 * The rules and thresholds are the dashboard's (portal/src/lib/insights.ts):
 * a phone alert and the card on the computer say the same thing. Each alert
 * goes out at most once per shop, type and day (`merchantInsights/{store}/
 * alerts/{type}_{day}`), and only while the shop is trading.
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { ONLINE_WITHIN_MS } from "../counterDisplay/manage";
import { MERCHANT_DISPLAYS, MerchantDisplay } from "../counterDisplay/types";
import { MERCHANT_TYPES } from "../counterDisplay/guard";
import { STATS_COLLECTION } from "../merchantStats/apply";
import { addDays, localParts } from "../merchantStats/time";
import { PeriodStats, StatsCurrency } from "../merchantStats/types";
import { notifyUser } from "../utils/notifications";
import { pushAmount } from "../utils/money";

/** The dashboard's thresholds (portal/src/lib/insights.ts RULES). */
export const ALERT_RULES = {
  quietTillMinExpected: 3,
  minWeeks: 3,
  refundSpikeMinCount: 2,
  refundSpikeShareOfSales: 0.1,
  refundSpikeTimesUsual: 3,
  displayOfflineAfterMs: 10 * 60 * 1000,
  /** Shops with a sale this many days back are checked. */
  activeWithinDays: 14,
};

export type AlertType = "quiet_till" | "display_offline" | "refund_spike";

export interface Alert {
  type: AlertType;
  /** The push text's values, raw. */
  values: { expected?: number; lastSaleAtMs?: number; name?: string; count?: number; amount?: number; currency?: StatsCurrency };
}

type Days = Map<string, PeriodStats>;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Hourly sales on a typical same weekday: median of up to 8 past weeks since the first sale. Pure. */
export function typicalCounts(days: Days, today: string, c: StatsCurrency): { count: number[]; weeks: number } {
  const traded = [...days.keys()].filter((k) => days.get(k)?.currencies?.[c]?.sales.count).sort();
  const first = traded[0];
  const past = Array.from({ length: 8 }, (_, i) => addDays(today, -7 * (i + 1))).filter((d) => first !== undefined && d >= first);
  const count = Array.from({ length: 24 }, (_, h) => median(past.map((d) => days.get(d)?.currencies?.[c]?.hours.count[h] ?? 0)));
  return { count, weeks: past.length };
}

export interface AlertInput {
  days: Days;
  today: string;
  hour: number;
  minute: number;
  nowMs: number;
  lastSaleAtMs: number | null;
  displays: Array<{ name: string; online: boolean; lastSeenAtMs: number | null }>;
}

/** What to push now, in dollars (the currency every shop takes). Pure. */
export function computeAlerts(input: AlertInput): Alert[] {
  const { days, today, hour, minute, nowMs } = input;
  const c: StatsCurrency = "USD";
  const out: Alert[] = [];
  const typical = typicalCounts(days, today, c);
  const now = days.get(today)?.currencies?.[c]?.hours.count ?? new Array(24).fill(0);
  const tradingNow =
    typical.weeks >= ALERT_RULES.minWeeks && (typical.count[hour] > 0 || (hour > 0 && typical.count[hour - 1] > 0));

  if (typical.weeks >= ALERT_RULES.minWeeks && hour >= 1) {
    const expected = typical.count[hour - 1] + typical.count[hour] * (minute / 60);
    const actual = now[hour - 1] + now[hour];
    const since = input.lastSaleAtMs ?? 0;
    if (expected >= ALERT_RULES.quietTillMinExpected && actual === 0 && nowMs - since > 90 * 60 * 1000) {
      out.push({ type: "quiet_till", values: { expected: Math.round(expected), lastSaleAtMs: since } });
    }
  }

  const offline = input.displays.find((d) => {
    const away = d.lastSeenAtMs === null ? Infinity : nowMs - d.lastSeenAtMs;
    return !d.online && away > ALERT_RULES.displayOfflineAfterMs;
  });
  if (offline && tradingNow) out.push({ type: "display_offline", values: { name: offline.name } });

  const t = days.get(today)?.currencies?.[c];
  let usual = 0;
  for (let i = 1; i <= 28; i++) usual += days.get(addDays(today, -i))?.currencies?.[c]?.refunds.gross ?? 0;
  if (
    t &&
    t.refunds.count >= ALERT_RULES.refundSpikeMinCount &&
    t.refunds.gross > Math.max(ALERT_RULES.refundSpikeShareOfSales * t.sales.gross, ALERT_RULES.refundSpikeTimesUsual * (usual / 28))
  ) {
    out.push({ type: "refund_spike", values: { count: t.refunds.count, amount: t.refunds.gross, currency: c } });
  }
  return out;
}

async function sendAlert(storeUid: string, a: Alert): Promise<void> {
  const data = { type: "insight_alert", insight: a.type };
  if (a.type === "quiet_till") {
    await notifyUser(
      storeUid,
      "insight_alert",
      a.values.lastSaleAtMs
        ? { key: "insight.quiet_till", params: { time: new Date(a.values.lastSaleAtMs) } }
        : { key: "insight.quiet_till_no_sale" },
      data
    );
  } else if (a.type === "display_offline") {
    await notifyUser(storeUid, "insight_alert", { key: "insight.display_offline", params: { name: a.values.name ?? "" } }, data);
  } else {
    await notifyUser(
      storeUid,
      "insight_alert",
      { key: "insight.refund_spike", params: { count: String(a.values.count), amount: pushAmount(a.values.amount ?? 0, a.values.currency ?? "USD") } },
      data
    );
  }
}

/** One shop: read what the rules need, push what's new today. */
export async function checkStore(db: FirebaseFirestore.Firestore, storeUid: string, nowMs: number): Promise<AlertType[]> {
  const { day: today, hour } = localParts(nowMs);
  // Hargeisa is a whole-hour offset from UTC, so the minute is UTC's.
  const minute = new Date(nowMs).getUTCMinutes();
  const root = db.collection(STATS_COLLECTION).doc(storeUid);
  // Today, the last 28 days (refunds) and 8 same weekdays back (typical day).
  const keys = new Set<string>([today]);
  for (let i = 1; i <= 28; i++) keys.add(addDays(today, -i));
  for (let w = 1; w <= 8; w++) keys.add(addDays(today, -7 * w));
  const [daySnaps, rootSnap, displaySnap] = await Promise.all([
    Promise.all([...keys].map((k) => root.collection("days").doc(k).get())),
    root.get(),
    db.collection(MERCHANT_DISPLAYS).where("merchantId", "==", storeUid).get(),
  ]);
  const days: Days = new Map();
  for (const s of daySnaps) if (s.exists) days.set(s.id, s.data() as PeriodStats);
  const displays = displaySnap.docs
    .map((d) => d.data() as MerchantDisplay)
    .filter((d) => d.status === "active")
    .map((d) => {
      const lastSeenAtMs = d.lastSeenAt ? d.lastSeenAt.toMillis() : null;
      return { name: d.name, online: lastSeenAtMs !== null && nowMs - lastSeenAtMs < ONLINE_WITHIN_MS, lastSeenAtMs };
    });
  const alerts = computeAlerts({
    days,
    today,
    hour,
    minute,
    nowMs,
    lastSaleAtMs: (rootSnap.data()?.lastSaleAtMs as number | undefined) ?? null,
    displays,
  });

  const sent: AlertType[] = [];
  for (const a of alerts) {
    // Once per shop, type and day: create fails if it already went out.
    const ref = db.collection("merchantInsights").doc(storeUid).collection("alerts").doc(`${a.type}_${today}`);
    try {
      await ref.create({ type: a.type, day: today, values: a.values, sentAt: Timestamp.fromMillis(nowMs) });
    } catch {
      continue;
    }
    try {
      await sendAlert(storeUid, a);
      sent.push(a.type);
    } catch (err) {
      console.error(`Insight alert ${a.type} to ${storeUid} failed:`, err);
    }
  }
  return sent;
}

export async function runInsightAlerts(nowMs = Date.now(), db: FirebaseFirestore.Firestore = admin.firestore()) {
  const since = addDays(localParts(nowMs).day, -ALERT_RULES.activeWithinDays);
  const active = await db.collection(STATS_COLLECTION).where("lastActivityDay", ">=", since).get();
  let pushed = 0;
  for (const doc of active.docs) {
    const user = (await db.collection("users").doc(doc.id).get()).data();
    if (!MERCHANT_TYPES.includes(user?.accountType)) continue;
    try {
      pushed += (await checkStore(db, doc.id, nowMs)).length;
    } catch (err) {
      console.error(`Insight alerts for ${doc.id} failed:`, err);
    }
  }
  console.log(`Insight alerts: ${active.size} active shops, ${pushed} pushed`);
  return { shops: active.size, pushed };
}

/** Every hour at :20, Hargeisa time (a few minutes into the hour, after the counter displays' heartbeats). */
export const merchantInsightAlerts = onSchedule(
  { schedule: "20 * * * *", timeZone: "Africa/Mogadishu", memory: "512MiB", timeoutSeconds: 300 },
  async () => {
    await runInsightAlerts();
  }
);

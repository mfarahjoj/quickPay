/**
 * What the Zapp Business dashboard reads through callables. Totals, the live
 * feed and customer records are read straight from `merchantStats` with
 * listeners (the rules let a live portal session read its shop's docs); these
 * are the things that need joins or the raw rows:
 *
 * - portalGetStore: who the shop is, balances, counter displays, the session
 * - portalGetCustomers: customer lists (top, recent, new, gone quiet) with names
 * - portalGetCustomer: one customer's record and their sales at the shop
 * - portalListTransactions: the shop's rows, newest first
 * - portalExportStatement: the same CSV the app's statement gives
 *
 * Names, never phone numbers: the privacy policy promises counterparties see
 * a name and the payment, never contact details.
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { https } from "firebase-functions/v2";
import { ONLINE_WITHIN_MS } from "../counterDisplay/manage";
import { shopName } from "../counterDisplay/state";
import { MERCHANT_DISPLAYS, MerchantDisplay } from "../counterDisplay/types";
import { statsRefs } from "../merchantStats/apply";
import { daysSinceLastVisit, LAPSED_MIN_DAYS, lapsedRegulars, lapseThresholdDays, monthlyValue } from "../merchantStats/customers";
import { addDays, localParts } from "../merchantStats/time";
import { CustomerStats } from "../merchantStats/types";
import { buildStatementCsv } from "../payouts/statement";
import { Transaction } from "../types";
import { kindOf } from "../utils/transactionKind";
import { linksFor } from "./groups";
import { requirePortalViewer } from "./viewer";

const MAX_PERIOD_MS = 93 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Db = FirebaseFirestore.Firestore;

/** Display names for user ids: a shop's business name, else the person's name. */
export async function partyNames(db: Db, ids: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string | null>();
  await Promise.all(
    unique.map(async (id) => {
      const [user, profile] = await Promise.all([
        db.collection("users").doc(id).get(),
        db.collection("merchantProfiles").doc(id).get(),
      ]);
      out.set(id, (profile.data()?.businessName as string) || (user.data()?.fullName as string) || null);
    })
  );
  return out;
}

const storeArg = (request: https.CallableRequest, viewerUid: string): string => {
  const s = (request.data as { storeUid?: unknown } | undefined)?.storeUid;
  return typeof s === "string" && s ? s : viewerUid;
};

// ─── The shop ──────────────────────────────────────────────────────────────

export const portalGetStore = https.onCall({ enforceAppCheck: true }, async (request) => {
  const viewer = await requirePortalViewer(request);
  const db = admin.firestore();
  const stores = await Promise.all(
    viewer.storeUids.map(async (storeUid) => {
      const [user, profile, wallet, displays] = await Promise.all([
        db.collection("users").doc(storeUid).get(),
        db.collection("merchantProfiles").doc(storeUid).get(),
        db.collection("wallets").doc(storeUid).get(),
        db.collection(MERCHANT_DISPLAYS).where("merchantId", "==", storeUid).get(),
      ]);
      const now = Date.now();
      const w = wallet.data();
      const p = profile.data();
      return {
        storeUid,
        name: shopName(user.data(), p),
        area: (p?.area as string) || (p?.businessAddress as string) || null,
        businessType: (p?.businessType as string) || null,
        accountType: (user.data()?.accountType as string) || null,
        autoPayout: p?.autoPayout?.enabled === true,
        balances: { USD: (w?.balance as number) ?? 0, SLS: (w?.sls?.balance as number) ?? 0 },
        displays: displays.docs
          .map((d) => d.data() as MerchantDisplay)
          .filter((d) => d.status === "active")
          .map((d) => {
            const lastSeenAtMs = d.lastSeenAt ? d.lastSeenAt.toMillis() : null;
            return { name: d.name, online: lastSeenAtMs !== null && now - lastSeenAtMs < ONLINE_WITHIN_MS, lastSeenAtMs };
          }),
      };
    })
  );
  const links = await linksFor(viewer.merchantUid);
  return {
    success: true,
    data: {
      merchantUid: viewer.merchantUid,
      stores,
      links,
      session: {
        sessionId: viewer.sessionId,
        browser: viewer.session.browser,
        expiresAtMs: viewer.session.expiresAt.toMillis(),
      },
      serverNowMs: Date.now(),
    },
  };
});

// ─── Customers ─────────────────────────────────────────────────────────────

type CustomerView = "top" | "recent" | "new" | "lapsed";

interface CustomersInput {
  storeUid?: unknown;
  view?: unknown;
  currency?: unknown;
  limit?: unknown;
}

function customerOut(c: CustomerStats, name: string | null | undefined, today: string) {
  return {
    customerUid: c.customerUid,
    name: name ?? null,
    visits: c.visits,
    visitDays: c.visitDays,
    spend: c.spend ?? {},
    refunded: c.refunded ?? {},
    firstSeenDay: c.firstSeenDay,
    lastSeenDay: c.lastSeenDay,
    lastSeenAtMs: c.lastSeenAtMs,
    usualGapDays: c.usualGapDays,
    daysSinceLastVisit: daysSinceLastVisit(c, today),
    lapseThresholdDays: lapseThresholdDays(c),
    monthlyValue: { USD: monthlyValue(c, "USD"), SLS: monthlyValue(c, "SLS") },
  };
}

export const portalGetCustomers = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<CustomersInput>) => {
    const viewer = await requirePortalViewer(request, request.data?.storeUid);
    const storeUid = storeArg(request, viewer.merchantUid);
    const view: CustomerView = (["top", "recent", "new", "lapsed"] as const).includes(request.data?.view as CustomerView)
      ? (request.data!.view as CustomerView)
      : "top";
    const currency = request.data?.currency === "SLS" ? "SLS" : "USD";
    const limit = Math.min(Math.max(Number(request.data?.limit) || 20, 1), 100);
    const db = admin.firestore();
    const col = statsRefs(db, storeUid).root.collection("customers");
    const now = Date.now();
    const today = localParts(now).day;

    let rows: CustomerStats[];
    if (view === "top") {
      rows = (await col.orderBy(currency === "SLS" ? "spendSLS" : "spendUSD", "desc").limit(limit).get()).docs
        .map((d) => d.data() as CustomerStats)
        .filter((c) => (c.spend?.[currency] ?? 0) > 0);
    } else if (view === "recent") {
      rows = (await col.orderBy("lastSeenAtMs", "desc").limit(limit).get()).docs.map((d) => d.data() as CustomerStats);
    } else if (view === "new") {
      rows = (await col.where("firstSeenDay", ">=", addDays(today, -6)).orderBy("firstSeenDay", "desc").limit(limit).get()).docs.map(
        (d) => d.data() as CustomerStats
      );
    } else {
      // Away at least the minimum lapse; then the per-customer rule decides.
      const candidates = (
        await col.where("lastSeenAtMs", "<", now - LAPSED_MIN_DAYS * DAY_MS).orderBy("lastSeenAtMs", "desc").limit(500).get()
      ).docs.map((d) => d.data() as CustomerStats);
      rows = lapsedRegulars(candidates, today).slice(0, limit);
    }

    const names = await partyNames(db, rows.map((c) => c.customerUid));
    return {
      success: true,
      data: { view, currency, today, customers: rows.map((c) => customerOut(c, names.get(c.customerUid), today)) },
    };
  }
);

export const portalGetCustomer = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ storeUid?: unknown; customerUid?: unknown }>) => {
    const viewer = await requirePortalViewer(request, request.data?.storeUid);
    const storeUid = storeArg(request, viewer.merchantUid);
    const customerUid = request.data?.customerUid;
    if (typeof customerUid !== "string" || !customerUid || customerUid.includes("/")) {
      throw new https.HttpsError("invalid-argument", "customerUid is required");
    }
    const db = admin.firestore();
    const snap = await statsRefs(db, storeUid).customer(customerUid).get();
    if (!snap.exists) throw new https.HttpsError("not-found", "No sales from this customer here.", { reason: "customer_not_found" });
    const today = localParts(Date.now()).day;
    const [names, sales] = await Promise.all([
      partyNames(db, [customerUid]),
      db
        .collection("transactions")
        .where("toUserId", "==", storeUid)
        .where("fromUserId", "==", customerUid)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get(),
    ]);
    return {
      success: true,
      data: {
        customer: customerOut(snap.data() as CustomerStats, names.get(customerUid), today),
        sales: sales.docs
          .map((d) => ({ id: d.id, t: d.data() as Transaction }))
          .filter(({ t }) => t.status === "completed")
          .map(({ id, t }) => ({
            id,
            atMs: (t.completedAt ?? t.createdAt).toMillis(),
            currency: t.currency === "SLS" ? "SLS" : "USD",
            gross: t.amount,
            net: t.netCents ?? t.amount - (t.feeCents ?? 0),
            refunded: t.refundedCents ?? t.amountRefunded ?? 0,
            reference: t.reference ?? null,
            receiptNumber: t.receiptNumber ?? null,
          })),
      },
    };
  }
);

// ─── Transactions ──────────────────────────────────────────────────────────

export const portalListTransactions = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ storeUid?: unknown; cursor?: unknown; limit?: unknown }>) => {
    const viewer = await requirePortalViewer(request, request.data?.storeUid);
    const storeUid = storeArg(request, viewer.merchantUid);
    const limit = Math.min(Math.max(Number(request.data?.limit) || 50, 1), 100);
    const db = admin.firestore();
    let q: FirebaseFirestore.Query = db
      .collection("transactions")
      .where("participants", "array-contains", storeUid)
      .orderBy("createdAt", "desc");
    const cursor = request.data?.cursor;
    if (typeof cursor === "number" && Number.isFinite(cursor)) q = q.startAfter(Timestamp.fromMillis(cursor));
    const snap = await q.limit(limit).get();

    const rows = snap.docs.map((d) => ({ id: d.id, t: d.data() as Transaction }));
    const names = await partyNames(
      db,
      rows.map(({ t }) => (t.fromUserId === storeUid ? t.toUserId : t.fromUserId)).filter((id) => id && id !== storeUid)
    );
    const transactions = rows.map(({ id, t }) => {
      const incoming = t.toUserId === storeUid && t.fromUserId !== storeUid;
      const other = t.fromUserId === storeUid ? t.toUserId : t.fromUserId;
      const fee = t.feeCents ?? 0;
      return {
        id,
        kind: kindOf(t),
        status: t.status,
        incoming,
        currency: t.currency === "SLS" ? "SLS" : "USD",
        gross: t.amount,
        fee,
        net: incoming ? t.netCents ?? t.amount - fee : t.amount,
        commission: t.commissionCents ?? 0,
        refunded: t.refundedCents ?? t.amountRefunded ?? 0,
        counterpartyName: other && other !== storeUid ? names.get(other) ?? null : null,
        description: t.description ?? "",
        reference: t.reference ?? null,
        receiptNumber: t.receiptNumber ?? null,
        createdAtMs: t.createdAt.toMillis(),
      };
    });
    const last = rows[rows.length - 1];
    return {
      success: true,
      data: { transactions, nextCursor: rows.length === limit && last ? last.t.createdAt.toMillis() : null },
    };
  }
);

export const portalExportStatement = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ storeUid?: unknown; fromMs?: unknown; toMs?: unknown }>) => {
    const viewer = await requirePortalViewer(request, request.data?.storeUid);
    const storeUid = storeArg(request, viewer.merchantUid);
    const fromMs = Number(request.data?.fromMs);
    const toMs = Number(request.data?.toMs);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > MAX_PERIOD_MS) {
      throw new https.HttpsError("invalid-argument", "Choose a period of up to three months");
    }
    const snap = await admin
      .firestore()
      .collection("transactions")
      .where("participants", "array-contains", storeUid)
      .where("createdAt", ">=", Timestamp.fromMillis(fromMs))
      .where("createdAt", "<", Timestamp.fromMillis(toMs))
      .orderBy("createdAt", "asc")
      .limit(MAX_ROWS + 1)
      .get();
    const rows = snap.docs.slice(0, MAX_ROWS).map((d) => ({ ...(d.data() as Transaction), id: d.id }));
    const { csv, totals, totalsSls } = buildStatementCsv(storeUid, rows);
    return { success: true, data: { csv, totals, totalsSls, truncated: snap.size > MAX_ROWS } };
  }
);

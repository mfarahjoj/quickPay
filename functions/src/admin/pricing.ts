/**
 * Pricing & rules — the admin console's editor for config/rates
 * (decisions D1 and D3: Zapp can price cash-out and set referral rules
 * without a deploy).
 *
 * Reading is open to every admin role; changing a price or rule takes a
 * super admin, a recent sign-in and a reason. Each value is checked against
 * its field's bounds in RATE_FIELDS and refused if out of range (the reader
 * would silently fall back to the default, which is worse than an error
 * here). The whole change and the values it replaced go into the audit log.
 *
 * Function instances cache rates for up to five minutes, so a change reaches
 * every instance within that window; the instance that saved it sees it at
 * once.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { ApiResponse } from "../types";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { requireAuth } from "../utils/validation";
import {
  RATE_FIELDS,
  RATE_KEYS,
  Rates,
  RateFieldSpec,
  clearRatesCache,
  getRates,
  resolveRates,
  validRateValue,
} from "../config/rates";

const RATES_DOC = () => admin.firestore().collection("config").doc("rates");

export interface RateRow {
  key: keyof Rates;
  spec: RateFieldSpec;
  value: number | string;
  /** False when the value in force is the default (nothing stored). */
  overridden: boolean;
}

export const adminGetRates = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<void>): Promise<ApiResponse<{ rows: RateRow[]; updatedAt: number | null }>> => {
    requireAdmin(request, ["super", "ops", "compliance"]);
    const snap = await RATES_DOC().get();
    const stored = snap.exists ? snap.data() ?? {} : {};
    const rates = resolveRates(stored);
    return {
      success: true,
      data: {
        rows: RATE_KEYS.map((key) => ({
          key,
          spec: RATE_FIELDS[key],
          value: rates[key],
          overridden: validRateValue(RATE_FIELDS[key], stored[key]) !== undefined,
        })),
        updatedAt: stored.updatedAt?.toMillis?.() ?? null,
      },
    };
  }
);

interface UpdateRatesRequest {
  /** Field → new value. A `null` value goes back to the default. */
  changes: Partial<Record<keyof Rates, number | string | null>>;
  reason: string;
}

export const adminUpdateRates = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<UpdateRatesRequest>): Promise<ApiResponse<{ changed: string[]; auditId: string }>> => {
    const actor = requireAdmin(request, "super");
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const changes = request.data?.changes;
    if (!changes || typeof changes !== "object" || Object.keys(changes).length === 0) {
      throw new https.HttpsError("invalid-argument", "Nothing to change");
    }

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      const spec = RATE_FIELDS[key as keyof Rates];
      if (!spec) throw new https.HttpsError("invalid-argument", `Unknown setting: ${key}`);
      if (value === null) {
        update[key] = admin.firestore.FieldValue.delete();
        continue;
      }
      if (validRateValue(spec, value) === undefined) {
        const range =
          spec.kind === "rate"
            ? `0 to ${spec.max * 100}%`
            : spec.kind === "enum"
              ? spec.options.map((o) => o.value).join(", ")
              : `${spec.min} to ${spec.max}`;
        throw new https.HttpsError("invalid-argument", `${spec.label} must be ${range}`, {
          reason: "out_of_range",
          key,
        });
      }
      update[key] = value;
    }

    const ref = RATES_DOC();
    const auditId = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const before = resolveRates(snap.exists ? snap.data() ?? {} : {});
      tx.set(ref, { ...update, updatedAt: admin.firestore.Timestamp.now(), updatedBy: actor.uid }, { merge: true });
      const keys = Object.keys(update);
      return stageAuditEntry(tx, {
        actor,
        action: "rates.update",
        target: { type: "rates", id: "config/rates" },
        reason,
        before: Object.fromEntries(keys.map((k) => [k, before[k as keyof Rates]])),
        after: Object.fromEntries(keys.map((k) => [k, changes[k as keyof Rates] ?? RATE_FIELDS[k as keyof Rates].default])),
      });
    });
    clearRatesCache();

    return { success: true, message: "Saved", data: { changed: Object.keys(update), auditId } };
  }
);

/** What the apps show: cash-out fee, payout time, referral terms. */
export const getPricing = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<void>) => {
    requireAuth(request);
    const r = await getRates();
    return {
      success: true,
      data: {
        cashOutFeeRate: r.cashOutFeeRate,
        payoutTargetHours: r.payoutTargetHours,
        autoPayoutMinCents: r.autoPayoutMinCents,
        referralUnlock: r.referralUnlock,
        referralBonusCents: r.referralBonusCents,
        referralMinCashInCents: r.referralMinCashInCents,
      },
    };
  }
);

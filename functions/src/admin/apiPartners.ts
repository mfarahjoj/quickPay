/**
 * Partners (api/partners.ts), set from the console.
 *
 * Making a merchant a partner lets its transfer-scoped keys pay any Zapp
 * account out of its wallet with no PIN, so it is a super-admin action with a
 * reason and an audit entry, and the caps are always set alongside it.
 */

import * as admin from "firebase-admin";
import { https } from "firebase-functions/v2";
import { requireAdmin, requireRecentAdminAuth, requireReason } from "./guard";
import { stageAuditEntry } from "./audit";
import { ApiResponse, User } from "../types";
import { isMerchantAccount } from "../api/keys";
import {
  DEFAULT_DAILY_TRANSFER_USD_CENTS,
  DEFAULT_MAX_TRANSFER_USD_CENTS,
  MAX_PARTNER_FEE_RATE,
} from "../api/partners";
import { API_PARTNERS_COLLECTION, ApiPartner } from "../api/types";

export interface ApiPartnerRow {
  transfersEnabled: boolean;
  maxTransferUsdCents: number;
  dailyTransferUsdCents: number;
  /** null: the standard online payment fee. */
  chargeFeeRate: number | null;
  updatedAt: string | null;
}

function toRow(p: ApiPartner | undefined): ApiPartnerRow {
  return {
    transfersEnabled: p?.transfersEnabled ?? false,
    maxTransferUsdCents: p?.maxTransferUsdCents ?? DEFAULT_MAX_TRANSFER_USD_CENTS,
    dailyTransferUsdCents: p?.dailyTransferUsdCents ?? DEFAULT_DAILY_TRANSFER_USD_CENTS,
    chargeFeeRate: typeof p?.chargeFeeRate === "number" ? p.chargeFeeRate : null,
    updatedAt: p?.updatedAt ? p.updatedAt.toDate().toISOString() : null,
  };
}

export const adminGetApiPartner = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<{ merchantId: string }>): Promise<ApiResponse<ApiPartnerRow>> => {
    requireAdmin(request, ["ops", "super"]);
    const merchantId = request.data?.merchantId;
    if (typeof merchantId !== "string" || !merchantId) {
      throw new https.HttpsError("invalid-argument", "merchantId is required");
    }
    const snap = await admin.firestore().collection(API_PARTNERS_COLLECTION).doc(merchantId).get();
    return { success: true, data: toRow(snap.data() as ApiPartner | undefined) };
  }
);

interface SetPartnerInput {
  merchantId: string;
  transfersEnabled: boolean;
  maxTransferUsdCents: number;
  dailyTransferUsdCents: number;
  chargeFeeRate: number | null;
  reason: string;
}

/** Pure, for testing: refuse anything that isn't a sane partner setting. */
export function validatePartnerInput(d: Partial<SetPartnerInput>): Omit<SetPartnerInput, "merchantId" | "reason"> {
  const cents = (v: unknown, name: string, max: number) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 100 || v > max) {
      throw new https.HttpsError("invalid-argument", `${name} must be whole US cents between 100 and ${max}`);
    }
    return v;
  };
  if (typeof d.transfersEnabled !== "boolean") {
    throw new https.HttpsError("invalid-argument", "transfersEnabled must be true or false");
  }
  const maxTransferUsdCents = cents(d.maxTransferUsdCents, "maxTransferUsdCents", 1_000_000);
  const dailyTransferUsdCents = cents(d.dailyTransferUsdCents, "dailyTransferUsdCents", 10_000_000);
  if (dailyTransferUsdCents < maxTransferUsdCents) {
    throw new https.HttpsError("invalid-argument", "The daily cap cannot be below the per-transfer cap");
  }
  const rate = d.chargeFeeRate;
  if (rate !== null && rate !== undefined && (typeof rate !== "number" || !(rate >= 0 && rate <= MAX_PARTNER_FEE_RATE))) {
    throw new https.HttpsError("invalid-argument", `chargeFeeRate must be between 0 and ${MAX_PARTNER_FEE_RATE}, or empty`);
  }
  return {
    transfersEnabled: d.transfersEnabled,
    maxTransferUsdCents,
    dailyTransferUsdCents,
    chargeFeeRate: typeof rate === "number" ? rate : null,
  };
}

export const adminSetApiPartner = https.onCall(
  { enforceAppCheck: true },
  async (request: https.CallableRequest<SetPartnerInput>): Promise<ApiResponse<ApiPartnerRow>> => {
    const actor = requireAdmin(request, ["super"]);
    requireRecentAdminAuth(request);
    const reason = requireReason(request.data?.reason);
    const merchantId = request.data?.merchantId;
    if (typeof merchantId !== "string" || !merchantId) {
      throw new https.HttpsError("invalid-argument", "merchantId is required");
    }
    const input = validatePartnerInput(request.data ?? {});

    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(merchantId).get();
    if (!userSnap.exists || !isMerchantAccount(userSnap.data() as User)) {
      throw new https.HttpsError("failed-precondition", "Only a merchant account can be a partner");
    }

    const ref = db.collection(API_PARTNERS_COLLECTION).doc(merchantId);
    const row = await db.runTransaction(async (tx) => {
      const before = (await tx.get(ref)).data() as ApiPartner | undefined;
      const { chargeFeeRate, ...rest } = input;
      const next: ApiPartner = {
        ...rest,
        ...(chargeFeeRate !== null ? { chargeFeeRate } : {}),
        updatedAt: admin.firestore.Timestamp.now(),
        updatedBy: actor.uid,
      };
      tx.set(ref, next);
      stageAuditEntry(tx, {
        actor,
        action: "api_partner.set",
        target: { type: "user", id: merchantId },
        reason,
        before: before ? { ...toRow(before) } : { transfersEnabled: false },
        after: { ...toRow(next) },
      });
      return toRow(next);
    });
    return { success: true, data: row };
  }
);

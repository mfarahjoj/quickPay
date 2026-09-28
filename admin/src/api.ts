/**
 * Typed wrappers over the admin callables.
 *
 * The console never touches Firestore directly — every read and write goes
 * through a callable that checks authority and writes the audit trail, which
 * is what lets firestore.rules stay closed to admins.
 */

import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

async function call<TReq, TRes>(name: string, payload?: TReq): Promise<TRes> {
  const fn = httpsCallable<TReq, ApiResponse<TRes>>(functions, name);
  const result = await fn(payload as TReq);
  const body = result.data;
  if (!body?.success) {
    throw new Error(body?.error || "Request failed");
  }
  return body.data as TRes;
}

export interface PayoutRow {
  id: string;
  merchantId: string;
  merchantName?: string;
  businessName?: string;
  amountCents: number;
  route: "cash" | "zaad" | "edahab" | "bank";
  destinationName: string;
  destinationRef: string;
  note?: string;
  status: "requested" | "paid" | "rejected";
  requiresSeniorApproval: boolean;
  externalReference?: string;
  createdAt?: { _seconds?: number; seconds?: number };
}

export interface UserSummary {
  userId: string;
  fullName?: string;
  phoneNumber?: string;
  accountType?: string;
  accountStatus: string;
  kycStatus?: string;
}

export interface TransactionRow {
  id: string;
  type?: string;
  amount?: number;
  currency?: string;
  status?: string;
  description?: string;
  fromUserId?: string;
  toUserId?: string;
  journalEntryId?: string;
  createdAt?: { _seconds?: number; seconds?: number };
}

export interface UserDetail {
  userId: string;
  profile: Record<string, unknown>;
  accountStatus: string;
  hasPin: boolean;
  wallet: { balance?: number; currency?: string; frozen?: boolean } | null;
  kyc: Record<string, unknown> | null;
  trustedDeviceCount: number;
  transactions: TransactionRow[];
}

/** A merchant's API key as the console sees it. The key itself is never listed. */
export interface ApiKeyRow {
  keyId: string;
  label: string;
  hint: string;
  revoked: boolean;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface RoleRequestRow {
  requestId: string;
  userId: string;
  requestedRole: string;
  businessName?: string;
  area?: string;
  note?: string;
  status: string;
  backfilled?: boolean;
  applicantName?: string;
  applicantPhone?: string;
  currentAccountType?: string;
}

export interface KycQueueRow {
  userId: string;
  idType?: string;
  status?: string;
  submittedAt?: { _seconds?: number; seconds?: number };
  applicantName?: string;
  applicantPhone?: string;
  accountType?: string;
}

export interface KycImage {
  label: "front" | "back" | "selfie";
  url?: string;
  error?: string;
}

export interface KycSubmission {
  userId: string;
  idType?: string;
  idNumber?: string;
  status?: string;
  submittedAt?: { _seconds?: number; seconds?: number };
  reviewedAt?: { _seconds?: number; seconds?: number } | null;
  rejectionReason?: string | null;
  images: KycImage[];
  applicant: {
    fullName?: string;
    phoneNumber?: string;
    accountType?: string;
    accountStatus?: string;
    kycStatus?: string;
    dateOfBirth?: string | null;
  };
  wallet: { balance?: number; currency?: string } | null;
}

export type FloatRoute = "cash" | "zaad" | "edahab" | "bank";
export type FloatDirection = "issue" | "withdraw";

export interface AgentPosition {
  agentId: string;
  fullName?: string;
  phoneNumber?: string;
  accountType?: string;
  accountStatus: string;
  balanceCents: number;
}

export interface FloatIssuanceRow {
  issuanceId: string;
  agentId: string;
  agentName?: string;
  direction: FloatDirection;
  amountCents: number;
  route: FloatRoute;
  externalReference?: string;
  status: string;
  requestedBy: string;
  requestedByEmail: string;
  requestReason: string;
  requiresSecondApprover: boolean;
  createdAt?: { _seconds?: number; seconds?: number };
}

export interface LedgerHealth {
  lastRun: {
    ranAt?: { _seconds?: number; seconds?: number };
    entryCount?: number;
    driftCount?: number;
    ok?: boolean;
  } | null;
  neverRun: boolean;
  openAlertCount: number;
}

export const api = {
  searchUsers: (query: string) =>
    call<{ query: string }, UserSummary[]>("adminSearchUsers", { query }),

  getUser: (userId: string) =>
    call<{ userId: string }, UserDetail>("adminGetUser", { userId }),

  setAccountStatus: (userId: string, status: "active" | "frozen", reason: string) =>
    call<{ userId: string; status: string; reason: string }, unknown>(
      "adminSetAccountStatus",
      { userId, status, reason }
    ),

  clearLockouts: (userId: string, reason: string) =>
    call<{ userId: string; reason: string }, unknown>("adminClearLockouts", {
      userId,
      reason,
    }),

  revokeDevices: (userId: string, reason: string) =>
    call<{ userId: string; reason: string }, { revoked: number }>(
      "adminRevokeUserDevices",
      { userId, reason }
    ),

  listApiKeys: (merchantId: string) =>
    call<{ merchantId: string }, { keys: ApiKeyRow[] }>("adminListApiKeys", {
      merchantId,
    }).then((body) => body.keys),

  /** Returns the full key exactly once; it cannot be fetched again. */
  issueApiKey: (merchantId: string, label: string, reason: string) =>
    call<
      { merchantId: string; label: string; reason: string },
      ApiKeyRow & { apiKey: string }
    >("adminIssueApiKey", { merchantId, label, reason }),

  revokeApiKey: (keyId: string, reason: string) =>
    call<{ keyId: string; reason: string }, ApiKeyRow>("adminRevokeApiKey", {
      keyId,
      reason,
    }),

  listRoleRequests: (status = "pending") =>
    call<{ status: string }, RoleRequestRow[]>("adminListRoleRequests", { status }),

  reviewRoleRequest: (
    requestId: string,
    decision: "approve" | "reject",
    reason: string
  ) =>
    call<{ requestId: string; decision: string; reason: string }, unknown>(
      "adminReviewRoleRequest",
      { requestId, decision, reason }
    ),

  ledgerHealth: () => call<void, LedgerHealth>("adminGetLedgerHealth"),

  listKycQueue: (status = "submitted") =>
    call<{ status: string }, KycQueueRow[]>("adminListKycQueue", { status }),

  getKycSubmission: (userId: string) =>
    call<{ userId: string }, KycSubmission>("adminGetKycSubmission", { userId }),

  reviewKyc: (userId: string, decision: "approve" | "reject", reason: string) =>
    call<{ userId: string; decision: string; reason: string }, unknown>(
      "adminReviewKyc",
      { userId, decision, reason }
    ),

  listAgentFloat: () => call<void, AgentPosition[]>("adminListAgentFloat"),

  listFloatIssuances: (status = "pending") =>
    call<{ status: string }, FloatIssuanceRow[]>("adminListFloatIssuances", {
      status,
    }),

  requestFloat: (payload: {
    agentId: string;
    direction: FloatDirection;
    amountCents: number;
    route: FloatRoute;
    externalReference?: string;
    reason: string;
  }) =>
    call<typeof payload, { issuanceId: string; requiresSecondApprover: boolean }>(
      "adminRequestFloat",
      payload
    ),

  approveFloat: (issuanceId: string, reason: string) =>
    call<{ issuanceId: string; reason: string }, unknown>("adminApproveFloat", {
      issuanceId,
      reason,
    }),

  rejectFloat: (issuanceId: string, reason: string) =>
    call<{ issuanceId: string; reason: string }, unknown>("adminRejectFloat", {
      issuanceId,
      reason,
    }),

  listPayouts: (status: PayoutRow["status"] = "requested") =>
    call<{ status: string }, { payouts: PayoutRow[] }>("adminListPayouts", {
      status,
    }).then((body) => body.payouts),

  settlePayout: (payoutId: string, externalReference: string, reason: string) =>
    call<
      { payoutId: string; externalReference: string; reason: string },
      unknown
    >("adminSettlePayout", { payoutId, externalReference, reason }),

  rejectPayout: (payoutId: string, reason: string) =>
    call<{ payoutId: string; reason: string }, unknown>("adminRejectPayout", {
      payoutId,
      reason,
    }),
};

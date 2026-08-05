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
};

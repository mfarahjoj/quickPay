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

async function call<TReq, TRes>(
  name: string,
  payload?: TReq,
  timeoutMs?: number
): Promise<TRes> {
  const fn = httpsCallable<TReq, ApiResponse<TRes>>(
    functions,
    name,
    timeoutMs ? { timeout: timeoutMs } : undefined
  );
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
  /** Raised by the merchant's daily automatic payout, not by hand. */
  auto?: boolean;
  externalReference?: string;
  createdAt?: { _seconds?: number; seconds?: number };
}

export interface HeldPayment {
  receiptId: string;
  provider: "zaad" | "edahab";
  operatorTxnId: string;
  amountCents: number;
  currency: string;
  senderMsisdn: string;
  senderName: string | null;
  /** unknown_sender | below_min | above_max | currency | no_wallet */
  reason: string;
  suggestedUid: string | null;
  receivedAt: number | null;
}

export interface ListenerPhone {
  deviceId: string;
  provider: "zaad" | "edahab";
  label: string;
  active: boolean;
  lastSeenAt: number | null;
  createdAt: number | null;
}

export interface ListenerSms {
  id: string;
  provider: "zaad" | "edahab";
  from: string;
  body: string;
  status: "unparsed" | "failed" | "ignored";
  receivedAt: number | null;
}

export interface CollectionEntry {
  number: string | null;
  active: boolean;
  senderIds: string[];
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
  receiptNumber?: string;
  reference?: string;
  createdAt?: { _seconds?: number; seconds?: number };
}

export interface UserDetail {
  userId: string;
  profile: Record<string, unknown>;
  accountStatus: string;
  hasPin: boolean;
  /** Locked after too many wrong PINs; a reset or Clear lockouts opens it. */
  pinHardLocked?: boolean;
  pinFailedAttempts?: number;
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
  mode?: "live" | "test";
  /** "transfers" on a partner's payout key. */
  scopes?: string[];
  lastUsedAt?: string;
  revokedAt?: string;
}

/** A merchant's partner settings: may it pay Zapp accounts by API, and its caps and fee. */
export interface ApiPartnerRow {
  transfersEnabled: boolean;
  maxTransferUsdCents: number;
  dailyTransferUsdCents: number;
  /** null: the standard online payment fee. */
  chargeFeeRate: number | null;
  /** Numbers outside +252 it may charge, pay and look up: Firebase test numbers. */
  testPhoneNumbers: string[];
  updatedAt: string | null;
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
  /** Float, in agent:{uid}. */
  balanceCents: number;
  /** Their own wallet: commission and, for an agent-merchant, sales. */
  walletCents?: number;
}

export interface AuthMigrationResult {
  applied: boolean;
  scanned: number;
  toMove: number;
  withPin: number;
  moved: number;
}

export interface FloatMigrationRow {
  agentId: string;
  fullName: string | null;
  computedCents: number;
  walletCents: number;
  floatCents: number;
  moveCents: number;
  alreadyMigrated: boolean;
  shortfallCents: number;
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
    spendIndexOk?: boolean;
    ok?: boolean;
  } | null;
  neverRun: boolean;
  openAlertCount: number;
  /**
   * Checked live on every call, not read off the last nightly run: when this
   * is not ok, nobody can pay, cash out or send money at all.
   */
  spendIndex?: { ok: boolean; error?: string };
}

type Ts = { _seconds?: number; seconds?: number };

/** One run of the invariant check (a `ledger_checkpoints` doc). */
export interface LedgerRun {
  id: string;
  ranAt: Ts | null;
  entryCount: number;
  accountCount: number;
  driftCount: number;
  spendIndexOk: boolean;
  ok: boolean;
  /** Activity-monitor findings: leads for review, kept apart from `ok`. */
  activityFindingCount: number;
  trigger: "schedule" | "manual" | string;
  triggeredBy: string | null;
}

export interface LedgerAlertSummary {
  id: string;
  ranAt: Ts | null;
  driftCount: number;
  spendIndexOk: boolean;
  activityFindingCount: number;
  acknowledged: boolean;
  acknowledgedByEmail: string | null;
  acknowledgedAt: Ts | null;
}

export interface LedgerOverview {
  runs: LedgerRun[];
  alerts: LedgerAlertSummary[];
  openAlertCount: number;
}

/** One mismatch. Cents; null where the check had no value (e.g. no wallet doc). */
export interface LedgerDriftRow {
  account: string;
  detail: string;
  /** What the journal says the balance should be. */
  expected: number | null;
  /** What the cached projection held when the check ran. */
  actual: number | null;
  /** actual − expected. Positive: the balance holds value the journal can't explain. */
  difference: number | null;
  /** The projection now; it may have moved since the check. */
  currentBalance: number | null;
  user: {
    userId: string;
    fullName: string | null;
    phoneNumber: string | null;
    accountType: string | null;
  } | null;
}

/**
 * Balanced entries that look like value creation, from the activity monitor
 * (functions/src/ledger/activityMonitor.ts). Leads for review, not verdicts.
 */
export interface LedgerActivityFinding {
  kind: "self_dealing" | "agent_commission" | "round_trip" | "fees_net" | string;
  account: string;
  counterparty: string | null;
  /** Cents: commission gained, value returned, or the platform:fees net. */
  amount: number | null;
  count: number;
  entryIds: string[];
  detail: string;
  user: LedgerDriftRow["user"];
  counterpartyUser: LedgerDriftRow["user"];
}

export interface LedgerAlertDetail extends LedgerAlertSummary {
  trigger: string;
  drifts: LedgerDriftRow[];
  shownCount: number;
  spendIndexError: string | null;
  activity: LedgerActivityFinding[];
  /** Journal entries the monitor read for this run's 24h window. */
  activityEntryCount: number | null;
  activityTruncated: boolean;
  activityError: string | null;
  acknowledgeReason: string | null;
}

export type LedgerLink = "posted" | "no-entry-id" | "entry-missing";

export interface LedgerTraceRow {
  id: string;
  type: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  description: string | null;
  createdAt: Ts | null;
  direction: "in" | "out" | null;
  journalEntryId: string | null;
  link: LedgerLink;
  entryType: string | null;
  walletEffect: number | null;
}

export interface LedgerTrace {
  account: string;
  user: LedgerDriftRow["user"];
  wallet: { balance: number | null; currency: string | null; frozen: boolean } | null;
  transactions: LedgerTraceRow[];
  truncated: boolean;
  summary: { completed: number; completedUnposted: number; completedUnpostedAmount: number };
}

export type DisputeStatus = "open" | "under_review" | "awaiting_funds" | "resolved" | "withdrawn";

export interface DisputeMessage {
  by: string;
  role: "raiser" | "counterparty" | "ops";
  text: string;
  /** Epoch ms. */
  at: number | null;
}

/** Timestamps are epoch milliseconds (null when absent). */
export interface DisputeRow {
  id: string;
  transactionId?: string;
  agentTopupRequestId?: string;
  disputedKind: string;
  kind: string;
  status: DisputeStatus;
  raisedBy: string;
  against: string | null;
  amountCents: number;
  transactionAmountCents: number;
  messages: DisputeMessage[];
  createdAt: number | null;
  respondBy: number | null;
  resolveBy: number | null;
  owedCents?: number;
  resolution?: {
    outcome: "upheld" | "rejected";
    amountCents: number;
    remedy: "refund" | "adjustment" | "none";
    payFrom: "counterparty" | "platform" | null;
    reason: string;
    decidedBy: string;
    decidedAt: number | null;
    settledAt: number | null;
    journalEntryId?: string;
  };
}

export interface DisputeParty {
  uid: string;
  fullName: string | null;
  phoneNumber: string | null;
  accountType: string | null;
  balanceCents: number | null;
  reservedCents: number;
}

export interface DisputeDetail {
  dispute: DisputeRow;
  transaction: (Record<string, unknown> & { createdAt: number | null }) | null;
  raiser: DisputeParty | null;
  against: DisputeParty | null;
}

export interface AdjustmentResult {
  adjustmentId: string;
  journalEntryId: string;
  alreadyPosted: boolean;
}

export type RateFieldSpec =
  | { kind: "rate"; group: string; label: string; help: string; default: number; max: number }
  | { kind: "cents" | "int"; group: string; label: string; help: string; default: number; min: number; max: number; unit?: string }
  | { kind: "enum"; group: string; label: string; help: string; default: string; options: { value: string; label: string }[] };

export interface RateRow {
  key: string;
  spec: RateFieldSpec;
  value: number | string;
  overridden: boolean;
}

export const api = {
  // Zaad / eDahab top-ups through the collection number (functions/src/mobileMoney/).
  listHeldMobileMoney: () => call<undefined, HeldPayment[]>("adminListHeldMobileMoney"),
  assignMobileMoney: (receiptId: string, uid: string, reason: string) =>
    call<{ receiptId: string; uid: string; reason: string }, unknown>("adminAssignMobileMoney", {
      receiptId,
      uid,
      reason,
    }),
  refundMobileMoney: (receiptId: string, reference: string, reason: string) =>
    call<{ receiptId: string; reference: string; reason: string }, unknown>("adminRefundMobileMoney", {
      receiptId,
      reference,
      reason,
    }),
  listListeners: () => call<undefined, ListenerPhone[]>("adminListListeners"),
  registerListener: (provider: "zaad" | "edahab", label: string) =>
    call<{ provider: string; label: string }, { deviceId: string; key: string; provider: string; label: string }>(
      "adminRegisterListener",
      { provider, label }
    ),
  listListenerSms: (status: ListenerSms["status"]) =>
    call<{ status: string }, ListenerSms[]>("adminListListenerSms", { status }),
  getCollection: () =>
    call<undefined, { zaad: CollectionEntry; edahab: CollectionEntry }>("adminGetCollection"),
  updateCollection: (
    provider: "zaad" | "edahab",
    entry: { number: string; active: boolean; senderIds: string[] },
    reason: string
  ) =>
    call<Record<string, unknown>, CollectionEntry>("adminUpdateCollection", { provider, ...entry, reason }),

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
  issueApiKey: (
    merchantId: string,
    label: string,
    reason: string,
    opts: { mode?: "live" | "test"; transfers?: boolean } = {}
  ) =>
    call<
      { merchantId: string; label: string; reason: string; mode?: "live" | "test"; transfers?: boolean },
      ApiKeyRow & { apiKey: string }
    >("adminIssueApiKey", { merchantId, label, reason, ...opts }),

  getApiPartner: (merchantId: string) =>
    call<{ merchantId: string }, ApiPartnerRow>("adminGetApiPartner", { merchantId }),

  setApiPartner: (
    merchantId: string,
    settings: Omit<ApiPartnerRow, "updatedAt">,
    reason: string
  ) =>
    call<Omit<ApiPartnerRow, "updatedAt"> & { merchantId: string; reason: string }, ApiPartnerRow>(
      "adminSetApiPartner",
      { merchantId, reason, ...settings }
    ),

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
    reason: string,
    idNumber?: string
  ) =>
    call<{ requestId: string; decision: string; reason: string; idNumber?: string }, unknown>(
      "adminReviewRoleRequest",
      { requestId, decision, reason, ...(idNumber ? { idNumber } : {}) }
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

  ledgerOverview: () => call<void, LedgerOverview>("adminGetLedgerOverview"),

  getLedgerAlert: (alertId: string) =>
    call<{ alertId: string }, LedgerAlertDetail>("adminGetLedgerAlert", { alertId }),

  traceLedgerAccount: (account: string) =>
    call<{ account: string }, LedgerTrace>("adminTraceLedgerAccount", { account }),

  acknowledgeLedgerAlert: (alertId: string, reason: string) =>
    call<{ alertId: string; reason: string }, { auditId: string }>(
      "adminAcknowledgeLedgerAlert",
      { alertId, reason }
    ),

  getRates: () => call<void, { rows: RateRow[]; updatedAt: number | null }>("adminGetRates"),

  /** `null` puts a setting back to its default. Super admins only. */
  updateRates: (changes: Record<string, number | string | null>, reason: string) =>
    call<{ changes: Record<string, number | string | null>; reason: string }, { changed: string[]; auditId: string }>(
      "adminUpdateRates",
      { changes, reason }
    ),

  /** Preview (apply false) or apply the one-off float split. */
  migrateAgentFloat: (apply: boolean, reason: string, overrides?: Record<string, number>) =>
    call<
      { apply: boolean; reason: string; overrides?: Record<string, number> },
      { applied: boolean; rows: FloatMigrationRow[] }
    >("adminMigrateAgentFloat", { apply, reason, overrides }, 5 * 60 * 1000),

  migrateAuthSecrets: (apply: boolean, reason: string) =>
    call<{ apply: boolean; reason: string }, AuthMigrationResult>(
      "adminMigrateAuthSecrets",
      { apply, reason },
      9 * 60 * 1000
    ),

  listDisputes: (status?: DisputeStatus) =>
    call<{ status?: string }, { disputes: DisputeRow[] }>("adminListDisputes", {
      status,
    }).then((body) => body.disputes),

  getDispute: (disputeId: string) =>
    call<{ disputeId: string }, DisputeDetail>("adminGetDispute", { disputeId }),

  resolveDispute: (payload: {
    disputeId: string;
    outcome: "upheld" | "rejected";
    reason: string;
    amountCents?: number;
    payFrom?: "counterparty" | "platform";
  }) =>
    call<
      typeof payload,
      { status: DisputeStatus; remedy: string; journalEntryId?: string; owedCents?: number }
    >("adminResolveDispute", payload),

  /** `idempotencyKey` must stay the same across retries of one correction. */
  postAdjustment: (payload: {
    debitAccount: string;
    creditAccount: string;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
  }) => call<typeof payload, AdjustmentResult>("adminPostAdjustment", payload),

  // A full journal replay can outlast the SDK's 70s default.
  runLedgerCheck: (reason: string) =>
    call<
      { reason: string },
      {
        runId: string;
        driftCount: number;
        entryCount: number;
        spendIndexOk: boolean;
        activityFindingCount: number;
      }
    >("adminRunLedgerCheck", { reason }, 9 * 60 * 1000),
};

// User types
export type KycStatus = "pending" | "submitted" | "verified" | "rejected";
export type PreferredLanguage = "en" | "so" | "ar";

/**
 * Operational state of an account, set by admins.
 *
 * `frozen` is reversible and blocks money movement; `closed` is the terminal
 * state used by account deletion. Absent on legacy docs — see
 * `resolveAccountStatus()` in utils/accountStatus.ts for how that is read.
 */
export type AccountStatus = "active" | "frozen" | "closed";

export interface UserAddress {
  city?: string;
  district?: string;
  country?: string;
}

export interface NotificationPreferences {
  push: boolean;
  transactionAlerts: boolean;
  promotions: boolean;
}

export interface LinkedAccounts {
  zaadPhone?: string;
  edahabPhone?: string;
}

export type AgentService = "cash_in" | "cash_out";

export interface AgentInfo {
  area: string;
  openHours: string;
  services: AgentService[];
  isActive: boolean;
  businessName?: string;
}

export interface User {
  phoneNumber: string;
  fullName: string;
  email?: string;
  dateOfBirth?: string;
  gender?: "male" | "female" | "other";
  address?: UserAddress;
  preferredLanguage: PreferredLanguage;
  accountType: "customer" | "merchant" | "topup_agent" | "agent_merchant";
  pinHash: string;
  /** Consecutive failed PIN attempts (reset on success / resetPin) */
  pinFailedAttempts?: number;
  /** PIN checks rejected until this time after too many failures */
  pinLockedUntil?: FirebaseFirestore.Timestamp | null;
  pinResetAt?: FirebaseFirestore.Timestamp;
  /** Recent PIN resets, newest last, for the reset rate limit. */
  pinResetHistory?: FirebaseFirestore.Timestamp[];
  /** Wrong ID answers to the new-phone reset check, and the lock they earn. */
  resetIdFailedAttempts?: number;
  resetIdLockedUntil?: FirebaseFirestore.Timestamp | null;
  /** Consecutive failed top-up/cash-out code guesses (agents only) */
  agentOtpFailedAttempts?: number;
  /** Code guesses rejected until this time after too many failures */
  agentOtpLockedUntil?: FirebaseFirestore.Timestamp | null;
  kycStatus: KycStatus;
  notificationPreferences: NotificationPreferences;
  linkedAccounts: LinkedAccounts;
  agentInfo?: AgentInfo;
  dailyTransactionLimit: number;
  monthlyTransactionLimit: number;
  referralCode: string;
  referredBy?: string;
  referralCount?: number;
  referralBonusClaimedAt?: FirebaseFirestore.Timestamp;
  lastLoginAt?: FirebaseFirestore.Timestamp;
  deletionRequestedAt?: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
  isActive: boolean;
  /**
   * Admin-controlled account state. Absent on accounts created before the
   * admin console; those fall back to `isActive` (see resolveAccountStatus).
   */
  accountStatus?: AccountStatus;
  /**
   * Mirror of the user's latest role application, so the apps can react on
   * their existing user-doc listener (roleRequests itself is server-only).
   * Written only by ensureRoleRequest and adminReviewRoleRequest.
   */
  roleRequestStatus?: RoleRequestStatus;
  roleRequestedRole?: PrivilegedRole;
  /** Reviewer's reason, surfaced to the applicant on rejection. */
  roleRequestReason?: string;
  /** Why the account was frozen — shown to support, not to the user. */
  frozenReason?: string;
  /** uid of the admin who last changed accountStatus. */
  frozenBy?: string;
  frozenAt?: FirebaseFirestore.Timestamp | null;
}

// Role request types — privileged roles are granted by admins, never
// self-selected. See ADMIN_CONSOLE_PLAN.md §4.1.
export type PrivilegedRole = "merchant" | "topup_agent" | "agent_merchant";
export type RoleRequestStatus = "pending" | "approved" | "rejected";

export interface RoleRequest {
  userId: string;
  requestedRole: PrivilegedRole;
  /** What the applicant told us, for the reviewer to sanity-check. */
  businessName?: string;
  area?: string;
  note?: string;
  status: RoleRequestStatus;
  createdAt: FirebaseFirestore.Timestamp;
  reviewedBy?: string;
  reviewedAt?: FirebaseFirestore.Timestamp;
  /** Reviewer's justification; on rejection this is shown to the applicant. */
  reason?: string;
  /**
   * Set on requests created by the migration audit for accounts that already
   * held a privileged role before the approval gate existed.
   */
  backfilled?: boolean;
}

// Float desk types — see ADMIN_CONSOLE_PLAN.md §4.3.
export type FloatDirection = "issue" | "withdraw";
export type FloatIssuanceStatus = "pending" | "approved" | "rejected";

/**
 * How the agent settled with us, which decides the asset account the value
 * landed in. Mirrors FloatRoute in ledger/accounts.ts — declared here rather
 * than imported so the type module stays independent of the ledger module.
 */
export type FloatRouteName = "cash" | "zaad" | "edahab" | "bank";

/**
 * One request to issue float to (or withdraw it from) an agent.
 *
 * Requesting and approving are separate steps: above the configured threshold
 * the approver must be a different admin, so no single person can move value
 * into an agent wallet on their own.
 */
export interface FloatIssuance {
  agentId: string;
  agentName?: string;
  direction: FloatDirection;
  amountCents: number;
  route: FloatRouteName;
  /** Zaad transaction id, deposit slip number, receipt number. */
  externalReference?: string;
  status: FloatIssuanceStatus;
  requestedBy: string;
  requestedByEmail: string;
  requestReason: string;
  /** Fixed when the request is raised, so a later rate change cannot weaken it. */
  requiresSecondApprover: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  decidedBy?: string;
  decidedAt?: FirebaseFirestore.Timestamp;
  decisionReason?: string;
  journalEntryId?: string;
  transactionId?: string;
}

/**
 * A merchant asking to be paid their takings.
 *
 * The rail is deliberately just a label plus a destination string: Zapp sends
 * the money by bank transfer, Zaad or cash depending on the merchant, and the
 * ledger only cares which float account the value leaves from. `externalRef`
 * is what makes the payout reconcilable against a statement later.
 */
export type PayoutStatus = "requested" | "paid" | "rejected";

export interface PayoutRequest {
  merchantId: string;
  merchantName?: string;
  businessName?: string;
  amountCents: number;
  /** Which float account the money will leave from when it is sent. */
  route: FloatRouteName;
  /** Account name as the merchant gave it — what ops types into the bank. */
  destinationName: string;
  /** Account number, IBAN or mobile-money phone number. */
  destinationRef: string;
  note?: string;
  status: PayoutStatus;
  /** Set when a second approver is needed because of the amount. */
  requiresSeniorApproval: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  /** Journal entry for the hold taken when the merchant asked. */
  holdEntryId: string;
  decidedBy?: string;
  decidedByEmail?: string;
  decidedAt?: FirebaseFirestore.Timestamp;
  decisionReason?: string;
  /** Bank reference, Zaad transaction id or receipt number. */
  externalReference?: string;
  settlementEntryId?: string;
  transactionId?: string;
}

// KYC document types
export interface KycDocument {
  idType: "national_id" | "passport" | "drivers_license";
  idNumber: string;
  frontPhotoUrl: string;
  backPhotoUrl?: string;
  selfieUrl: string;
  /**
   * Bucket-relative object paths, resolved at submission time.
   *
   * The URL fields are `getDownloadURL()` links: permanent and
   * unauthenticated. Reviewers get short-lived signed URLs minted from these
   * paths instead, so a leaked console response does not expose someone's
   * passport photo indefinitely. Absent on submissions predating this.
   */
  frontPhotoPath?: string;
  backPhotoPath?: string;
  selfiePath?: string;
  status: KycStatus;
  /** Denormalised so the review queue can filter without reading the parent. */
  userId?: string;
  submittedAt: FirebaseFirestore.Timestamp;
  reviewedAt?: FirebaseFirestore.Timestamp;
  reviewedBy?: string;
  rejectionReason?: string;
}

// Wallet types
export interface Wallet {
  balance: number; // Stored in cents
  currency: "USD" | "SLS";
  totalReceived: number;
  totalSent: number;
  lastTransactionAt: FirebaseFirestore.Timestamp | null;
  updatedAt: FirebaseFirestore.Timestamp;
  /**
   * Mirror of `users.accountStatus !== "active"`, written atomically with it.
   *
   * It lives here so `prepareJournalEntry` — which already reads every
   * affected wallet — can refuse to debit a frozen account without a second
   * read per money movement. The user doc stays the source of truth; this is
   * a projection, like `balance`.
   */
  frozen?: boolean;
}

// Transaction types
export type TransactionType = "payment" | "topup" | "withdrawal" | "refund" | "referral";
export type TransactionStatus = "pending" | "completed" | "failed" | "cancelled";

export interface Transaction {
  type: TransactionType;
  fromUserId: string;
  toUserId: string;
  /** [fromUserId, toUserId] — enables a single array-contains query per user. */
  participants?: string[];
  amount: number; // Gross amount, in cents
  /** Platform fee withheld from a payment, in cents (merchant absorbs it). */
  feeCents?: number;
  /** Amount actually credited to the receiver after fees, in cents. */
  netCents?: number;
  /** Agent commission earned on a top-up, in cents. */
  commissionCents?: number;
  currency: string;
  status: TransactionStatus;
  qrCodeId?: string;
  description: string;
  /** Free-text reference / order number shown to the merchant. */
  reference?: string;
  /** On a refund transaction: the id of the payment being refunded. */
  refundOfTransactionId?: string;
  /** On a refunded payment: when it was refunded and the refund tx id. */
  refundedAt?: FirebaseFirestore.Timestamp;
  refundTransactionId?: string;
  /** Journal entry that moved the money (accounting source of truth). */
  journalEntryId?: string;
  /** Cash-out only: the entry that took the hold (journalEntryId is the settlement once completed). */
  holdEntryId?: string;
  /** Cash-out only: the entry that returned the hold to the customer. */
  releaseEntryId?: string;
  /**
   * Set on a payment taken through the merchant API, and on its refunds.
   * Such a payment is refunded through the API only, where partial refunds
   * are tracked on the charge — see refundPayment.
   */
  apiChargeId?: string;
  /** On an API payment: cents refunded so far, across partial refunds. */
  amountRefunded?: number;
  createdAt: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp;
  errorMessage?: string;
}

// QR Code types
export type QRCodeStatus = "active" | "used" | "expired";

export interface QRCode {
  merchantId: string;
  amount: number; // In cents
  currency: string;
  status: QRCodeStatus;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  /** EMV/SOMQR payload rendered by the merchant app. */
  emvQrData?: string;
  reference?: string;
  usedBy?: string;
  usedAt?: FirebaseFirestore.Timestamp;
  cancelledAt?: FirebaseFirestore.Timestamp;
  /**
   * Settlement details written by processPayment in the same transaction as
   * the journal entry. The merchant app watches this doc to confirm the sale
   * on-screen, so these must land atomically with the money movement — never
   * as a follow-up write that could fail on its own.
   */
  paidByName?: string;
  paidAmount?: number; // Gross, in cents
  feeCents?: number;
  netCents?: number;
  transactionId?: string;
}

// Top-up types
export type TopupMethod = "zaad" | "edahab" | "stripe";
export type TopupStatus = "initiated" | "pending" | "completed" | "failed";

export interface Topup {
  userId: string;
  amount: number; // In cents
  currency: string;
  method: TopupMethod;
  status: TopupStatus;
  externalTransactionId?: string;
  reference?: string;
  webhookReceived: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp;
  errorMessage?: string;
}

// Settlement types
export type SettlementStatus = "pending" | "processing" | "completed" | "rejected";

export interface Settlement {
  merchantId: string;
  amount: number; // In cents
  currency: string;
  method: TopupMethod;
  status: SettlementStatus;
  destinationAccount: string;
  externalTransactionId?: string;
  createdAt: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp;
  rejectionReason?: string;
}

// Merchant Profile types
export interface MerchantProfile {
  businessName: string;
  businessType: string;
  businessAddress: string;
  settlementPreference: TopupMethod;
  zaadAccount?: string;
  edahabAccount?: string;
  bankAccount?: {
    accountNumber: string;
    bankName: string;
    accountName: string;
  };
  minimumSettlementAmount: number; // In cents
}

// Notification types
export interface Notification {
  userId: string;
  type:
    | "payment_received"
    | "payment_sent"
    | "topup_completed"
    | "settlement_completed"
    | "refund_issued"
    | "role_approved"
    | "role_rejected"
    | "float_issued"
    | "float_withdrawn"
    | "payout_sent"
    | "payout_rejected"
    | "kyc_approved"
    | "kyc_rejected"
    | "pin_reset"
    | "cashout_completed"
    | "cashout_returned";
  title: string;
  body: string;
  data?: Record<string, string>;
  read: boolean;
  createdAt: FirebaseFirestore.Timestamp;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Customer token types (customer-presented QR)
export type CustomerTokenStatus = "active" | "scanned" | "used" | "expired";

export interface CustomerToken {
  customerId: string;
  status: CustomerTokenStatus;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  scannedBy?: string;
  scannedAt?: FirebaseFirestore.Timestamp;
}

// Merchant-initiated payment request types
export type PaymentRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export interface MerchantPaymentRequest {
  merchantId: string;
  customerId: string;
  tokenId: string;
  amount: number; // In cents
  currency: string;
  status: PaymentRequestStatus;
  reference?: string;
  createdAt: FirebaseFirestore.Timestamp;
  /**
   * When the customer can no longer approve. Absent on requests raised before
   * this field existed; `requestExpiryMillis` supplies their old 5-minute limit.
   */
  expiresAt?: FirebaseFirestore.Timestamp;
  resolvedAt?: FirebaseFirestore.Timestamp;
  /** The `transactions` row an approval wrote, so a retried approval can return it. */
  transactionId?: string;
}

// Remittance types
export type RemittanceStatus = "pending" | "completed" | "failed";

export interface Remittance {
  senderId: string;
  recipientPhone: string;
  recipientId: string | null;
  amount: number;
  currency: string;
  status: RemittanceStatus;
  stripePaymentIntentId?: string;
  senderName?: string;
  note?: string;
  transactionId?: string;
  createdAt: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp;
}

// Payment processing types (legacy QR scan flow)
export interface QRPaymentRequest {
  qrCodeId: string;
  customerId: string;
  pin: string;
}

export interface PaymentResponse {
  transactionId: string;
  status: TransactionStatus;
  amount: number;
  merchantId: string;
}

// QR Code generation types
export interface GenerateQRRequest {
  merchantId: string;
  amount: number;
  currency: string;
}

export interface GenerateQRResponse {
  qrCodeId: string;
  qrData: string;
  emvQrData: string;
  expiresAt: Date;
  /** Platform fee the merchant absorbs on this sale, in cents. */
  feeCents: number;
  /** What actually lands in the merchant wallet, in cents. */
  netCents: number;
  merchantName: string;
}

// Cash-out via agent types
export type CashOutStatus = "pending" | "completed" | "expired" | "cancelled";

export interface CashOutRequest {
  customerId: string;
  agentId?: string;
  amount: number; // In cents
  currency: string;
  otpCode: string; // 6-digit one-time code shown to agent
  status: CashOutStatus;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp;
  /** The customer's history row, written as "pending" when the hold is taken. */
  transactionId?: string;
  /**
   * Code attempts against this request, by any agent, counted before each
   * comparison (so a successful one is counted too). The fifth wrong one
   * returns the money; no attempt past the fifth is compared at all.
   */
  failedAttempts?: number;
  /** Why held money went back to the customer. */
  releaseReason?: CashOutReleaseReason;
  releasedAt?: FirebaseFirestore.Timestamp;
}

/** cancelled: by the customer · replaced: a newer request superseded it · expired: unclaimed in time · too_many_attempts: wrong codes */
export type CashOutReleaseReason = "cancelled" | "replaced" | "expired" | "too_many_attempts";

export type AgentTopupStatus = "pending" | "completed" | "expired" | "cancelled";

// Customer-initiated agent cash-in: the customer generates this request, pays
// the agent cash, and the agent confirms it (by QR/code) to credit the wallet.
export interface AgentTopupRequest {
  customerId: string;
  agentId?: string; // Set when an agent confirms
  amount: number; // In cents
  currency: string;
  otpCode: string; // 6-digit code shown to agent (also encoded in the QR)
  status: AgentTopupStatus;
  expiresAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  confirmationId?: string; // Unique id recorded on confirmation (= transactionId)
  transactionId?: string;
  completedAt?: FirebaseFirestore.Timestamp;
}

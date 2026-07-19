// User types
export type KycStatus = "pending" | "submitted" | "verified" | "rejected";
export type PreferredLanguage = "en" | "so" | "ar";

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
}

// KYC document types
export interface KycDocument {
  idType: "national_id" | "passport" | "drivers_license";
  idNumber: string;
  frontPhotoUrl: string;
  backPhotoUrl?: string;
  selfieUrl: string;
  status: KycStatus;
  submittedAt: FirebaseFirestore.Timestamp;
  reviewedAt?: FirebaseFirestore.Timestamp;
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
  reference?: string;
  usedBy?: string;
  usedAt?: FirebaseFirestore.Timestamp;
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
    | "refund_issued";
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
export type PaymentRequestStatus = "pending" | "approved" | "rejected" | "expired";

export interface MerchantPaymentRequest {
  merchantId: string;
  customerId: string;
  tokenId: string;
  amount: number; // In cents
  currency: string;
  status: PaymentRequestStatus;
  reference?: string;
  createdAt: FirebaseFirestore.Timestamp;
  resolvedAt?: FirebaseFirestore.Timestamp;
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
}

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

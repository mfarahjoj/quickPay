export type KycStatus = 'pending' | 'submitted' | 'verified' | 'rejected';
export type PreferredLanguage = 'en' | 'so' | 'ar';

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

export interface User {
  uid: string;
  phoneNumber: string;
  fullName: string;
  email?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  address?: UserAddress;
  preferredLanguage: PreferredLanguage;
  accountType: 'customer' | 'merchant' | 'topup_agent' | 'agent_merchant';
  kycStatus: KycStatus;
  notificationPreferences: NotificationPreferences;
  linkedAccounts: LinkedAccounts;
  dailyTransactionLimit: number;
  monthlyTransactionLimit: number;
  referralCode: string;
  referredBy?: string;
  isActive: boolean;
}

export interface Wallet {
  balance: number;
  balanceCents: number;
  currency: string;
  totalReceived: number;
  totalSent: number;
  lastTransactionAt: Date | null;
}

export type TransactionType = 'payment' | 'topup' | 'withdrawal' | 'refund';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number; // Gross, in dollars
  fee: number; // Platform fee, in dollars
  net: number; // Net received after fees, in dollars
  commission: number; // Agent commission, in dollars
  currency: string;
  status: TransactionStatus;
  description: string;
  reference?: string;
  createdAt: Date;
  completedAt?: Date;
  isIncoming: boolean;
  otherPartyId: string;
  counterpartyName: string | null;
  counterpartyPhone: string | null;
  refundedAt?: Date;
  refundOfTransactionId?: string;
}

export type SummaryPeriod = 'today' | 'week' | 'month';

export interface TransactionSummary {
  period: SummaryPeriod;
  currency: string;
  netTakings: number;
  paymentsNet: number;
  commission: number;
  count: number;
  previousNetTakings: number;
  deltaPct: number | null;
}

export interface QRCodeData {
  qrCodeId: string;
  qrData: string;
  expiresAt: Date;
}

export interface PaymentResult {
  transactionId: string;
  status: TransactionStatus;
  amount: number;
  merchantId: string;
}

export interface MerchantInfo {
  uid: string;
  businessName: string;
  phoneNumber: string;
  accountType: 'merchant' | 'topup_agent' | 'agent_merchant';
  isActive: boolean;
}

export interface CustomerLookupResult {
  userId: string;
  phoneNumber: string;
  fullName: string;
  accountType: string;
}

export interface TopupRecord {
  id: string;
  userId: string;
  agentId: string;
  amount: number;
  amountDollars: number;
  currency: string;
  paymentMethod: string;
  reference: string;
  status: string;
  transactionId: string;
  createdAt: Date;
  completedAt?: Date;
}

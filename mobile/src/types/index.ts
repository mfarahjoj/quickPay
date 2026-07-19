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
  accountType: 'customer' | 'merchant';
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
  balance: number; // In dollars
  balanceCents: number; // In cents
  currency: string;
  totalReceived: number;
  totalSent: number;
  lastTransactionAt: Date | null;
}

export type TransactionType = 'payment' | 'topup' | 'withdrawal' | 'refund' | 'referral';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number; // In dollars
  currency: string;
  status: TransactionStatus;
  description: string;
  createdAt: Date;
  completedAt?: Date;
  isIncoming: boolean;
  otherPartyId: string;
  counterpartyName?: string | null;
  counterpartyPhone?: string | null;
  net?: number;
  fee?: number;
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

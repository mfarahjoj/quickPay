import * as admin from "firebase-admin";

// Initialize Firebase Admin
admin.initializeApp();

// Auth functions
// NOTE: onUserCreate is intentionally not exported to avoid mixed-gen
// deploy conflicts. User/wallet initialization is handled in setupPin.
export { setupPin } from "./auth/setupPin";
export { validateUserPin } from "./auth/validatePin";
export { changePin } from "./auth/changePin";
export { resetPin } from "./auth/resetPin";
export {
  registerTrustedDevice,
  loginWithPin,
  revokeTrustedDevices,
} from "./auth/trustedDevice";
export { updateProfile } from "./auth/updateProfile";
export { submitKYC } from "./auth/submitKYC";
export { requestAccountDeletion } from "./auth/deleteAccount";
export { getAccountLimits } from "./auth/getAccountLimits";

// Wallet functions
export { getBalance } from "./wallet/getBalance";
export { getTransactions } from "./wallet/getTransactions";
export { getTransactionSummary } from "./wallet/getTransactionSummary";
export { sendP2P } from "./wallet/sendP2P";
export { payrollPayout } from "./wallet/payrollPayout";

// QR Payment functions
export { generateQRCode } from "./qr-payments/generateQR";
export { validateQRCode } from "./qr-payments/validateQR";
export { cancelQRCode } from "./qr-payments/cancelQR";
export { processPayment } from "./qr-payments/processPayment";
export { payMerchant } from "./qr-payments/payMerchant";
export { refundPayment } from "./qr-payments/refundPayment";

// Manual Top-up functions (for MVP - physical cash points)
export { manualTopup, getAgentTopupHistory } from "./topup/manualTopup";

// Agent cash-out (customer gets OTP → shows to agent → agent confirms)
export { customerCashOut } from "./topup/customerCashOut";
export { agentConfirmCashOut } from "./topup/agentConfirmCashOut";
export { customerRequestAgentTopup } from "./topup/customerRequestAgentTopup";
export { agentConfirmTopup } from "./topup/agentConfirmTopup";

// Mobile money top-up & cash-out (Zaad/eDahab)
export { topupFromMobileMoney, cashOutToMobileMoney } from "./topup/mobileMoneyTopup";
export { mobileMoneyWebhook } from "./topup/mobileMoneyWebhook";

// User lookup (for agents)
export { lookupUserByPhone } from "./users/lookupUser";

// Customer QR token functions
export { generateCustomerToken } from "./customer-qr/generateToken";
export { scanCustomerToken } from "./customer-qr/scanToken";
export { createPaymentRequest } from "./customer-qr/createPaymentRequest";
export { approvePaymentRequest } from "./customer-qr/approvePayment";
export { rejectPaymentRequest } from "./customer-qr/rejectPayment";

// Merchant functions
export { registerMerchant } from "./merchants/registerMerchant";
export { getMerchantProfile } from "./merchants/getMerchantProfile";
export { generateMerchantSticker } from "./merchants/generateMerchantSticker";
export { setupAgentProfile } from "./merchants/setupAgentProfile";

// Referral functions
export { getReferralStats } from "./referral/getReferralStats";

// Remittance functions (diaspora)
export { createRemittance } from "./remittance/createRemittance";
export { completeRemittance } from "./remittance/completeRemittance";
export { createWebTopup } from "./remittance/createWebTopup";
export { stripeWebhook } from "./remittance/stripeWebhook";

// Ledger integrity (LEDGER_ARCHITECTURE.md §3.5)
export { ledgerInvariantCheck } from "./ledger/invariantCheck";

// Admin console (see ADMIN_CONSOLE_PLAN.md). Every callable here is gated by
// custom claims in admin/guard.ts and writes to the admin_audit log.
export { adminSetAccountStatus } from "./admin/setAccountStatus";
export {
  adminListRoleRequests,
  adminReviewRoleRequest,
} from "./admin/reviewRoleRequest";
export {
  adminSearchUsers,
  adminGetUser,
  adminClearLockouts,
  adminRevokeUserDevices,
  adminGetLedgerHealth,
} from "./admin/lookupUser";
export {
  adminRequestFloat,
  adminApproveFloat,
  adminRejectFloat,
  adminListFloatIssuances,
  adminListAgentFloat,
} from "./admin/floatDesk";
export {
  adminListKycQueue,
  adminGetKycSubmission,
  adminReviewKyc,
} from "./admin/kycReview";

// Role applications (privileged roles are granted by admins, not chosen)
export { requestRole, getMyRoleRequests } from "./merchants/requestRole";

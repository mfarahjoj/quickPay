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
export { cancelCashOut } from "./topup/cancelCashOut";
// Returns unclaimed cash-out holds and closes stale top-up codes, every 5 minutes
export { expireAgentRequests } from "./topup/expireAgentRequests";
export { customerRequestAgentTopup } from "./topup/customerRequestAgentTopup";
export { agentConfirmTopup } from "./topup/agentConfirmTopup";

// Mobile money top-up & cash-out (Zaad/eDahab)
//
// `topupFromMobileMoney` / `cashOutToMobileMoney` are NOT exported, and were
// deleted from prod on 2026-09-18. `functions/src/integrations/` are sandbox
// stubs that fake success, and `*_SANDBOX` defaults to "true" whenever the env
// var is unset — which it is, since this repo ships no `.env`. The top-up
// callable turned that fake success straight into a wallet credit against
// float:zaad, so any signed-in user could mint balance up to their per-tx cap
// and cash it out at an agent (money rule 3). The cash-out callable is the
// mirror image: it debits a real wallet and pays out nothing.
//
// Do not re-export either until the stubs refuse to run in prod and a real
// Telesom/Somtel rail is connected — see BACKLOG.md item 3b.
export { mobileMoneyWebhook } from "./topup/mobileMoneyWebhook";

// User lookup (for agents)
export { lookupUserByPhone } from "./users/lookupUser";

// Customer QR token functions
export { generateCustomerToken } from "./customer-qr/generateToken";
export { scanCustomerToken } from "./customer-qr/scanToken";
export { createPaymentRequest } from "./customer-qr/createPaymentRequest";
export { approvePaymentRequest } from "./customer-qr/approvePayment";
export { rejectPaymentRequest } from "./customer-qr/rejectPayment";
export { cancelPaymentRequest } from "./customer-qr/cancelPayment";

// Merchant functions
export { registerMerchant } from "./merchants/registerMerchant";
export { getMerchantProfile } from "./merchants/getMerchantProfile";
export { generateMerchantSticker } from "./merchants/generateMerchantSticker";
export { setupAgentProfile } from "./merchants/setupAgentProfile";

// Referral functions
export { getReferralStats } from "./referral/getReferralStats";

// Remittance functions (diaspora)
//
// `createRemittance` / `completeRemittance` are NOT exported, and were deleted
// from prod on 2026-09-18. `completeRemittance` took the paymentIntentId from
// the client and never checked it against the remittance's own
// stripePaymentIntentId or amount, so with the Stripe stub answering
// "succeeded" for any id (stripe.service.ts), a sender could credit any
// recipient without paying. Even against live Stripe, one real intent could be
// replayed against a larger remittance.
//
// Re-export only when the credit comes from the verified webhook and is matched
// to the stored intent id and amount.
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
// Reconciliation: read what the invariant check found, trace it, re-run it
export {
  adminGetLedgerOverview,
  adminGetLedgerAlert,
  adminTraceLedgerAccount,
  adminAcknowledgeLedgerAlert,
  adminRunLedgerCheck,
} from "./admin/ledgerDesk";

// Merchant settlement: the merchant asks, ops sends the transfer and records it
export { requestPayout } from "./payouts/requestPayout";
export {
  adminListPayouts,
  adminSettlePayout,
  adminRejectPayout,
} from "./admin/payoutDesk";

// Role applications (privileged roles are granted by admins, not chosen)
export { requestRole, getMyRoleRequests } from "./merchants/requestRole";

// Merchant Payments API (docs/MERCHANT_API.md). `api` serves /v1/... behind a
// Hosting rewrite; money moves only in approveApiCharge, under the customer's
// PIN, and in API refunds, which only ever return a customer's own payment.
export { api } from "./api/app";
export { getApiCharge, approveApiCharge } from "./api/approveApiCharge";
export { expireApiCharges } from "./api/expireCharges";
export { onApiChargeWritten, retryWebhookDeliveries } from "./api/webhooks";
export {
  adminListApiKeys,
  adminIssueApiKey,
  adminRevokeApiKey,
} from "./admin/apiKeys";

/**
 * eDahab (Dahabshil) integration.
 *
 * SANDBOX MODE: All calls simulate a successful response with a fake
 * transaction ID.  Set EDAHAB_SANDBOX=false and provide real credentials
 * to switch to the live eDahab API.
 */

import axios from "axios";
import { generateSecureId } from "../utils/encryption";

const EDAHAB_SANDBOX = (process.env.EDAHAB_SANDBOX ?? "true") === "true";
const EDAHAB_API_URL = process.env.EDAHAB_API_URL || "https://api.edahab.com/v1";
const EDAHAB_MERCHANT_ID = process.env.EDAHAB_MERCHANT_ID || "";
const EDAHAB_API_KEY = process.env.EDAHAB_API_KEY || "";

export interface EDahabPaymentRequest {
  phoneNumber: string;
  amount: number;
  reference: string;
}

export interface EDahabPaymentResponse {
  success: boolean;
  transactionId?: string;
  status?: string;
  message?: string;
  error?: string;
}

function sandboxResponse(reference: string): EDahabPaymentResponse {
  return {
    success: true,
    transactionId: `EDAHAB_SANDBOX_${generateSecureId(8)}`,
    status: "completed",
    message: `Sandbox: ${reference} processed`,
  };
}

export async function initiateEDahabPayment(
  request: EDahabPaymentRequest
): Promise<EDahabPaymentResponse> {
  if (EDAHAB_SANDBOX) {
    console.log(`[eDahab Sandbox] Payment: ${request.amount} cents to ${request.phoneNumber}`);
    return sandboxResponse(request.reference);
  }

  try {
    const response = await axios.post(
      `${EDAHAB_API_URL}/payments`,
      {
        merchant_id: EDAHAB_MERCHANT_ID,
        phone_number: request.phoneNumber,
        amount: request.amount / 100,
        reference: request.reference,
      },
      {
        headers: {
          Authorization: `Bearer ${EDAHAB_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    return {
      success: true,
      transactionId: response.data.transaction_id,
      status: response.data.status,
      message: response.data.message,
    };
  } catch (error: any) {
    console.error("eDahab payment error:", error);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

export async function checkEDahabPaymentStatus(
  transactionId: string
): Promise<EDahabPaymentResponse> {
  if (EDAHAB_SANDBOX) {
    return { success: true, transactionId, status: "completed" };
  }

  try {
    const response = await axios.get(
      `${EDAHAB_API_URL}/payments/${transactionId}`,
      {
        headers: { Authorization: `Bearer ${EDAHAB_API_KEY}` },
        timeout: 10000,
      }
    );

    return {
      success: true,
      transactionId: response.data.transaction_id,
      status: response.data.status,
    };
  } catch (error: any) {
    console.error("eDahab status check error:", error);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

export async function initiateEDahabPayout(
  request: EDahabPaymentRequest
): Promise<EDahabPaymentResponse> {
  if (EDAHAB_SANDBOX) {
    console.log(`[eDahab Sandbox] Payout: ${request.amount} cents to ${request.phoneNumber}`);
    return sandboxResponse(request.reference);
  }

  try {
    const response = await axios.post(
      `${EDAHAB_API_URL}/payouts`,
      {
        merchant_id: EDAHAB_MERCHANT_ID,
        phone_number: request.phoneNumber,
        amount: request.amount / 100,
        reference: request.reference,
      },
      {
        headers: {
          Authorization: `Bearer ${EDAHAB_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    return {
      success: true,
      transactionId: response.data.transaction_id,
      status: response.data.status,
    };
  } catch (error: any) {
    console.error("eDahab payout error:", error);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

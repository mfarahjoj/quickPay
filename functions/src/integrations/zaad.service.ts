/**
 * Zaad Service integration.
 *
 * SANDBOX MODE: All calls simulate a successful response with a fake
 * transaction ID.  Set ZAAD_SANDBOX=false and provide real credentials
 * to switch to the live Zaad API.
 */

import axios from "axios";
import { generateSecureId } from "../utils/encryption";

const ZAAD_SANDBOX = (process.env.ZAAD_SANDBOX ?? "true") === "true";
const ZAAD_API_URL = process.env.ZAAD_API_URL || "https://api.zaad.com/v1";
const ZAAD_MERCHANT_ID = process.env.ZAAD_MERCHANT_ID || "";
const ZAAD_API_KEY = process.env.ZAAD_API_KEY || "";

export interface ZaadPaymentRequest {
  phoneNumber: string;
  amount: number;
  reference: string;
}

export interface ZaadPaymentResponse {
  success: boolean;
  transactionId?: string;
  status?: string;
  message?: string;
  error?: string;
}

function sandboxResponse(reference: string): ZaadPaymentResponse {
  return {
    success: true,
    transactionId: `ZAAD_SANDBOX_${generateSecureId(8)}`,
    status: "completed",
    message: `Sandbox: ${reference} processed`,
  };
}

export async function initiateZaadPayment(
  request: ZaadPaymentRequest
): Promise<ZaadPaymentResponse> {
  if (ZAAD_SANDBOX) {
    console.log(`[Zaad Sandbox] Payment: ${request.amount} cents to ${request.phoneNumber}`);
    return sandboxResponse(request.reference);
  }

  try {
    const response = await axios.post(
      `${ZAAD_API_URL}/payments`,
      {
        merchant_id: ZAAD_MERCHANT_ID,
        phone_number: request.phoneNumber,
        amount: request.amount / 100,
        reference: request.reference,
      },
      {
        headers: {
          Authorization: `Bearer ${ZAAD_API_KEY}`,
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
    console.error("Zaad payment error:", error);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

export async function checkZaadPaymentStatus(
  transactionId: string
): Promise<ZaadPaymentResponse> {
  if (ZAAD_SANDBOX) {
    return { success: true, transactionId, status: "completed" };
  }

  try {
    const response = await axios.get(
      `${ZAAD_API_URL}/payments/${transactionId}`,
      {
        headers: { Authorization: `Bearer ${ZAAD_API_KEY}` },
        timeout: 10000,
      }
    );

    return {
      success: true,
      transactionId: response.data.transaction_id,
      status: response.data.status,
    };
  } catch (error: any) {
    console.error("Zaad status check error:", error);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

export async function initiateZaadPayout(
  request: ZaadPaymentRequest
): Promise<ZaadPaymentResponse> {
  if (ZAAD_SANDBOX) {
    console.log(`[Zaad Sandbox] Payout: ${request.amount} cents to ${request.phoneNumber}`);
    return sandboxResponse(request.reference);
  }

  try {
    const response = await axios.post(
      `${ZAAD_API_URL}/payouts`,
      {
        merchant_id: ZAAD_MERCHANT_ID,
        phone_number: request.phoneNumber,
        amount: request.amount / 100,
        reference: request.reference,
      },
      {
        headers: {
          Authorization: `Bearer ${ZAAD_API_KEY}`,
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
    console.error("Zaad payout error:", error);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
}

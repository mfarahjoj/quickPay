/**
 * Stripe integration for diaspora remittances.
 *
 * SANDBOX MODE: All calls return simulated responses so the app can be
 * tested end-to-end without a Stripe account.  Set STRIPE_SANDBOX=false
 * and provide a real STRIPE_SECRET_KEY to switch to the live Stripe API.
 */

import { generateSecureId } from "../utils/encryption";

const STRIPE_SANDBOX = (process.env.STRIPE_SANDBOX ?? "true") === "true";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";

export interface StripePaymentIntentRequest {
  amount: number;
  currency: string;
  customerId: string;
  description?: string;
}

export interface StripePaymentIntentResponse {
  success: boolean;
  clientSecret?: string;
  paymentIntentId?: string;
  error?: string;
}

export async function createPaymentIntent(
  request: StripePaymentIntentRequest
): Promise<StripePaymentIntentResponse> {
  if (STRIPE_SANDBOX) {
    const fakeId = `pi_sandbox_${generateSecureId(12)}`;
    console.log(
      `[Stripe Sandbox] PaymentIntent: ${request.amount} ${request.currency} for ${request.customerId}`
    );
    return {
      success: true,
      clientSecret: `${fakeId}_secret_sandbox`,
      paymentIntentId: fakeId,
    };
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: request.amount,
      currency: request.currency.toLowerCase(),
      metadata: {
        userId: request.customerId,
        description: request.description || "QuickPay wallet top-up",
      },
      automatic_payment_methods: { enabled: true },
    });

    return {
      success: true,
      clientSecret: paymentIntent.client_secret || undefined,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error: any) {
    console.error("Stripe payment intent error:", error);
    return { success: false, error: error.message };
  }
}

export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export async function getPaymentIntent(
  paymentIntentId: string
): Promise<StripePaymentIntent | null> {
  if (STRIPE_SANDBOX) {
    return {
      id: paymentIntentId,
      status: "succeeded",
      amount: 0,
      currency: "usd",
    };
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
    };
  } catch (error: any) {
    console.error("Stripe get payment intent error:", error);
    return null;
  }
}

export async function createRefund(
  paymentIntentId: string,
  amount?: number
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  if (STRIPE_SANDBOX) {
    return { success: true, refundId: `re_sandbox_${generateSecureId(8)}` };
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount,
    });
    return { success: true, refundId: refund.id };
  } catch (error: any) {
    console.error("Stripe refund error:", error);
    return { success: false, error: error.message };
  }
}

export function verifyWebhook(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): unknown | null {
  if (STRIPE_SANDBOX) {
    return JSON.parse(typeof payload === "string" ? payload : payload.toString());
  }

  try {
    const Stripe = require("stripe").default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error: any) {
    console.error("Stripe webhook verification error:", error);
    return null;
  }
}

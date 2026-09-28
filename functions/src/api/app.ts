/**
 * Zapp Merchant Payments API — `/v1/...`, served by the `api` function and
 * routed from Hosting (firebase.json). See docs/MERCHANT_API.md.
 *
 *   POST   /v1/charges                    create (Idempotency-Key required)
 *   GET    /v1/charges                    list
 *   GET    /v1/charges/:id                retrieve (POS polling)
 *   POST   /v1/charges/:id/cancel         cancel while pending
 *   POST   /v1/charges/:id/refunds        refund, full or partial (Idempotency-Key required)
 *   POST   /v1/webhook_endpoints          add an endpoint; the secret is shown once
 *   GET    /v1/webhook_endpoints          list
 *   DELETE /v1/webhook_endpoints/:id      remove
 *   GET    /v1/public/charges/:id         unauthenticated; the hosted checkout's view
 *
 * No route here moves money on its own: a charge is paid only when the
 * customer approves it in the app (approveApiCharge), and a refund only ever
 * returns a customer's own payment.
 */

import * as crypto from "crypto";
import { https } from "firebase-functions/v2";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { ENCRYPTION_KEY } from "../config/secrets";
import { getRates } from "../config/rates";
import {
  ApiError,
  Route,
  bodyOf,
  compileRoutes,
  matchRoute,
  sendError,
  sendJson,
  toApiError,
} from "./http";
import { ApiCaller, authenticateApiKey } from "./keys";
import { enforceApiRateLimit, requireIdempotencyKeyHeader } from "./requestGuards";
import {
  cancelCharge,
  createCharge,
  getOwnCharge,
  getPublicCharge,
  listCharges,
  serializeCharge,
  serializePublicCharge,
} from "./charges";
import { createRefund, serializeRefund } from "./refunds";
import { createEndpoint, deleteEndpoint, listEndpoints } from "./webhooks";

interface Ctx {
  req: Request;
  res: Response;
  caller: ApiCaller;
}

const authed = compileRoutes<Ctx>([
  {
    method: "POST",
    path: "/v1/charges",
    handler: async ({ req, res, caller }) => {
      const key = requireIdempotencyKeyHeader(req);
      const { id, charge, replayed } = await createCharge(caller, bodyOf(req), key);
      if (replayed) res.set("Idempotent-Replayed", "true");
      return { status: replayed ? 200 : 201, body: serializeCharge(id, charge) };
    },
  },
  {
    method: "GET",
    path: "/v1/charges",
    handler: async ({ req, caller }) => ({
      body: await listCharges(caller.merchantId, req.query as Record<string, unknown>),
    }),
  },
  {
    method: "GET",
    path: "/v1/charges/:id",
    handler: async ({ caller }, { id }) => ({
      body: serializeCharge(id, await getOwnCharge(caller.merchantId, id)),
    }),
  },
  {
    method: "POST",
    path: "/v1/charges/:id/cancel",
    handler: async ({ caller }, { id }) => ({ body: await cancelCharge(caller.merchantId, id) }),
  },
  {
    method: "POST",
    path: "/v1/charges/:id/refunds",
    handler: async ({ req, res, caller }, { id }) => {
      const key = requireIdempotencyKeyHeader(req);
      const result = await createRefund(caller, id, bodyOf(req), key);
      if (result.replayed) res.set("Idempotent-Replayed", "true");
      return { status: result.replayed ? 200 : 201, body: serializeRefund(result.id, result.refund) };
    },
  },
  {
    method: "POST",
    path: "/v1/webhook_endpoints",
    handler: async ({ req, caller }) => ({
      status: 201,
      body: await createEndpoint(caller.merchantId, bodyOf(req)),
    }),
  },
  {
    method: "GET",
    path: "/v1/webhook_endpoints",
    handler: async ({ caller }) => ({ body: await listEndpoints(caller.merchantId) }),
  },
  {
    method: "DELETE",
    path: "/v1/webhook_endpoints/:id",
    handler: async ({ caller }, { id }) => ({ body: await deleteEndpoint(caller.merchantId, id) }),
  },
] as Route<Ctx>[]);

const publicRoutes = compileRoutes<{ req: Request }>([
  {
    method: "GET",
    path: "/v1/public/charges/:id",
    handler: async (_ctx, { id }) => ({ body: serializePublicCharge(id, await getPublicCharge(id)) }),
  },
]);

/** Exported for tests; the deployed function is `api` below. */
export async function handleApiRequest(req: Request, res: Response): Promise<void> {
  const started = Date.now();
  const requestId = `req_${crypto.randomBytes(9).toString("base64url")}`;
  res.set("Zapp-Request-Id", requestId);
  const path = req.path.replace(/\/+$/, "") || "/";
  let merchantId: string | undefined;
  let status = 500;

  try {
    const publicMatch = matchRoute(publicRoutes, req.method, path);
    if (publicMatch.kind === "found") {
      const out = await publicMatch.route.handler({ req }, publicMatch.params);
      status = out.status ?? 200;
      sendJson(res, status, out.body);
      return;
    }

    const match = matchRoute(authed, req.method, path);
    if (match.kind === "not_found" && publicMatch.kind === "not_found") {
      throw new ApiError(404, "not_found_error", "route_not_found", `No route for ${req.method} ${path}`);
    }
    if (match.kind !== "found") {
      throw new ApiError(405, "invalid_request_error", "method_not_allowed", `${req.method} is not allowed on ${path}`);
    }

    // Authenticate before rate limiting, so an unauthenticated flood cannot
    // exhaust a real merchant's allowance.
    const caller = await authenticateApiKey(req);
    merchantId = caller.merchantId;
    const { apiRequestsPerMinute } = await getRates();
    await enforceApiRateLimit(caller.keyId, apiRequestsPerMinute);

    const out = await match.route.handler({ req, res, caller }, match.params);
    status = out.status ?? 200;
    sendJson(res, status, out.body);
  } catch (err) {
    const apiErr = toApiError(err);
    status = apiErr.status;
    if (status >= 500) console.error(`API ${requestId} failed:`, err);
    sendError(res, apiErr);
  } finally {
    console.log(
      JSON.stringify({
        api: true,
        requestId,
        method: req.method,
        path,
        status,
        merchantId,
        ms: Date.now() - started,
      })
    );
  }
}

export const api = https.onRequest(
  {
    // ENCRYPTION_KEY encrypts webhook signing secrets at rest.
    secrets: [ENCRYPTION_KEY],
    cors: false,
    // /v1/public/charges/:id is unauthenticated (the checkout page polls it),
    // so cap what a flood of requests can cost. At the default concurrency of
    // 80 this is still far beyond Hargeisa-launch traffic.
    maxInstances: 20,
  },
  handleApiRequest
);

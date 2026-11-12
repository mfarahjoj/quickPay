/**
 * Errors and routing for the public API.
 *
 * Deliberately a few dozen lines rather than Express: the API has a handful of
 * routes, the Cloud Functions request is already Express-shaped, and a money
 * endpoint is a poor place to add a dependency.
 */

import { https } from "firebase-functions/v2";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

export type ApiErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "conflict_error"
  | "idempotency_error"
  | "rate_limit_error"
  | "api_error";

/**
 * An error the integrator is meant to read. `code` is stable and meant for
 * their code to branch on; `message` is for their logs and may change.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: ApiErrorType,
    readonly code: string,
    message: string,
    readonly param?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (code: string, message: string, param?: string) =>
  new ApiError(400, "invalid_request_error", code, message, param);

export const notFound = (what: string) =>
  new ApiError(404, "not_found_error", "resource_missing", `No such ${what}`);

export const conflict = (code: string, message: string) =>
  new ApiError(409, "conflict_error", code, message);

/**
 * The guards shared with the callables (limits, account status, velocity)
 * throw HttpsError. Translate rather than duplicate them.
 */
const HTTPS_STATUS: Record<string, [number, ApiErrorType]> = {
  "invalid-argument": [400, "invalid_request_error"],
  "failed-precondition": [409, "conflict_error"],
  "permission-denied": [403, "permission_error"],
  "unauthenticated": [401, "authentication_error"],
  "not-found": [404, "not_found_error"],
  "already-exists": [409, "conflict_error"],
  "resource-exhausted": [429, "rate_limit_error"],
};

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof https.HttpsError) {
    const mapped = HTTPS_STATUS[err.code];
    if (mapped) {
      return new ApiError(mapped[0], mapped[1], err.code.replace(/-/g, "_"), err.message);
    }
  }
  return new ApiError(500, "api_error", "internal_error", "Something went wrong on our side");
}

export function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status);
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(JSON.stringify(body));
}

export function sendError(res: Response, err: ApiError): void {
  sendJson(res, err.status, {
    error: {
      type: err.type,
      code: err.code,
      message: err.message,
      ...(err.param ? { param: err.param } : {}),
    },
  });
}

export type Method = "GET" | "POST" | "DELETE";

export interface Route<Ctx> {
  method: Method;
  /** e.g. "/v1/charges/:id/cancel" */
  path: string;
  handler: (ctx: Ctx, params: Record<string, string>) => Promise<{ status?: number; body: unknown }>;
}

interface CompiledRoute<Ctx> extends Route<Ctx> {
  regex: RegExp;
  keys: string[];
}

/** Path params are IDs; anything outside this set is not a route of ours. */
const PARAM_PATTERN = "([A-Za-z0-9_-]{1,128})";

export function compileRoutes<Ctx>(routes: Route<Ctx>[]): CompiledRoute<Ctx>[] {
  return routes.map((route) => {
    const keys: string[] = [];
    const source = route.path
      .split("/")
      .map((part) => {
        if (part.startsWith(":")) {
          keys.push(part.slice(1));
          return PARAM_PATTERN;
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { ...route, regex: new RegExp(`^${source}/?$`), keys };
  });
}

export type Match<Ctx> =
  | { kind: "found"; route: CompiledRoute<Ctx>; params: Record<string, string> }
  | { kind: "method_not_allowed" }
  | { kind: "not_found" };

export function matchRoute<Ctx>(
  routes: CompiledRoute<Ctx>[],
  method: string,
  path: string
): Match<Ctx> {
  let pathMatched = false;
  for (const route of routes) {
    const m = route.regex.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (route.method !== method) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, i) => (params[key] = m[i + 1]));
    return { kind: "found", route, params };
  }
  return pathMatched ? { kind: "method_not_allowed" } : { kind: "not_found" };
}

/** The JSON body as an object, or {} — never an array or a primitive. */
export function bodyOf(req: Request): Record<string, unknown> {
  const body = req.body;
  if (body && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

export function header(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

# Zapp Merchant Payments API (v1)

Take Zapp Pay on a website, in an app, or from a till. You create a **charge**;
the customer approves it in the Zapp Pay app with their PIN; you get a webhook
(or poll) when it's paid. You never handle the customer's credentials, and
nothing moves until the customer approves.

- **Base URL:** `https://quickpay-485417.web.app/v1`
- **Money:** integer **cents**, currency `USD`. `1250` = $12.50.
- **Format:** JSON in, JSON out.

Code: `functions/src/api/`. Ledger templates: `LEDGER_ARCHITECTURE.md` §3.4.

---

## 1. Authentication

Zapp operations issues your key from the admin console. It is shown **once**:
store it in your server's secret store and never ship it to a browser or app.

```
Authorization: Bearer zpk_live_…
```

Lost or leaked key → ask Zapp to revoke it and issue a new one. You can hold up
to five active keys (e.g. one per till) so you can rotate without downtime.

**Rate limit:** 120 requests per minute per key (HTTP `429` beyond that).

## 2. Idempotency

`POST /v1/charges` and `POST /v1/charges/{id}/refunds` **require** an
`Idempotency-Key` header: 8–255 printable characters, unique per attempt
(a UUID, or your order number plus an attempt counter).

Retrying with the same key returns the original object with
`Idempotent-Replayed: true`, so a timeout followed by a retry can never charge
or refund twice. Reusing a key with **different** parameters is refused
(`422 idempotency_key_reused`).

## 3. Charges

### Create

```bash
curl https://quickpay-485417.web.app/v1/charges \
  -H "Authorization: Bearer $ZAPP_KEY" \
  -H "Idempotency-Key: order-1001-a1" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1250,
    "reference": "Order #1001",
    "metadata": { "order_id": "1001" },
    "success_url": "https://shop.example/thanks",
    "cancel_url": "https://shop.example/cart"
  }'
```

| Field | | |
|---|---|---|
| `amount` | required | Positive integer, cents |
| `currency` | optional | `USD` only (default) |
| `reference` | optional | ≤128 chars. Shown to the customer and on both sides' receipts |
| `metadata` | optional | ≤20 string key/values, for your own bookkeeping. Never shown to the customer |
| `customer_phone` | optional | `+252…`. If it belongs to a Zapp customer, they get a push notification and **only they** can pay the charge. The response is the same whether or not the number has an account |
| `success_url` / `cancel_url` | optional | `https://` URLs the hosted checkout sends the shopper back to |
| `expires_in` | optional | Seconds, 60–86400. Default 900 (15 min) |

Response `201`:

```json
{
  "id": "ch_Q2x8…",
  "object": "charge",
  "amount": 1250,
  "currency": "USD",
  "status": "pending",
  "reference": "Order #1001",
  "metadata": { "order_id": "1001" },
  "amount_refunded": 0,
  "fee": null,
  "net": null,
  "checkout_url": "https://quickpay-485417.web.app/checkout/ch_Q2x8…",
  "qr_payload": "https://quickpay-485417.web.app/checkout/ch_Q2x8…",
  "deep_link": "zapppay://charge/ch_Q2x8…",
  "created": "2026-09-27T12:00:00.000Z",
  "expires_at": "2026-09-27T12:15:00.000Z",
  "succeeded_at": null,
  "livemode": true
}
```

**Statuses:** `pending` → exactly one of `succeeded`, `expired`, `canceled`.
Only `succeeded` has money behind it. After success, `fee` and `net` show the
platform fee and what reached your wallet.

### Two ways to collect

- **Online:** redirect the shopper to `checkout_url`. On a computer it shows a
  QR to scan with the Zapp app; on a phone it shows an **Open Zapp Pay**
  button. When paid, it sends the shopper to your `success_url`.
- **Till / POS:** render `qr_payload` as a QR on the customer-facing display
  (it's the checkout URL, so even a phone camera without the app lands on the
  checkout page). Then poll `GET /v1/charges/{id}` every 2–3 s, or wait for the
  webhook.

**Always confirm payment server-side** (webhook or `GET`), never from the
shopper arriving at `success_url` — anyone can type that URL.

### Retrieve, list, cancel

```
GET  /v1/charges/{id}
GET  /v1/charges?status=succeeded&limit=20&starting_after=ch_…
POST /v1/charges/{id}/cancel
```

Cancel a pending charge when the shopper pays another way. Cancelling an
already-cancelled or expired charge returns it unchanged. Cancelling a paid
charge is refused (`409 charge_already_succeeded`) — refund it instead. A
cancel and an approval landing at the same moment resolve one way or the
other, never both.

## 4. Refunds

```bash
curl https://quickpay-485417.web.app/v1/charges/ch_Q2x8…/refunds \
  -H "Authorization: Bearer $ZAPP_KEY" \
  -H "Idempotency-Key: refund-1001-1" \
  -H "Content-Type: application/json" \
  -d '{ "amount": 500, "reason": "One item out of stock" }'
```

Omit `amount` to refund whatever is left. Partial refunds may be repeated until
the charge is fully refunded. The money comes from your Zapp wallet and goes
back to the customer who paid; Zapp returns its fee in proportion, so a
charge refunded in parts costs you exactly what a single full refund would.
Your wallet must hold enough to cover it (`409 insufficient_balance`).

Payments taken through the API are refunded through the API only — the
merchant app's refund button refuses them, so a payment can't be refunded
twice through two doors.

## 5. Webhooks

```
POST   /v1/webhook_endpoints        { "url": "https://shop.example/hooks/zapp" }
GET    /v1/webhook_endpoints
DELETE /v1/webhook_endpoints/{id}
```

Creating an endpoint returns its signing `secret` (`whsec_…`) **once**. Up to
five endpoints; public `https` URLs only.

**Events:** `charge.succeeded`, `charge.expired`, `charge.canceled`,
`charge.refunded` (one per refund).

```json
{
  "id": "evt_ch_Q2x8…_succeeded",
  "object": "event",
  "type": "charge.succeeded",
  "created": "2026-09-27T12:03:10.000Z",
  "data": { "object": { "id": "ch_Q2x8…", "object": "charge", "status": "succeeded", "…": "…" } }
}
```

Reply `2xx` within 10 seconds. Anything else is retried after 1 min, 5 min,
30 min, 2 h, 6 h, 12 h and 24 h (8 attempts over ~3 days). Deliveries can
arrive more than once and out of order: key your handling on the event `id`
(also sent as `Zapp-Event-Id`) and re-`GET` the charge if order matters.

### Verify the signature

Every delivery carries `Zapp-Signature: t=<unix seconds>,v1=<hex>`, where `v1`
is HMAC-SHA256 of `"<t>.<raw request body>"` under your endpoint secret.
Verify against the **raw** body, before parsing, and reject stale timestamps:

```js
const crypto = require("crypto");

function verifyZappSignature(header, rawBody, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const given = Buffer.from(parts.v1 || "", "hex");
  const want = Buffer.from(expected, "hex");
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
```

(Zapp's own reference implementation, which the test suite exercises, is
`verifySignature` in `functions/src/api/webhooks.ts`.)

## 6. Errors

```json
{ "error": { "type": "invalid_request_error", "code": "amount_invalid", "message": "…", "param": "amount" } }
```

| HTTP | `type` | Common `code`s |
|---|---|---|
| 400 | `invalid_request_error` | `amount_invalid`, `parameter_invalid`, `url_invalid`, `phone_invalid`, `idempotency_key_required`, `amount_too_large` |
| 401 | `authentication_error` | `missing_api_key`, `invalid_api_key` |
| 403 | `permission_error` | `not_a_merchant`, `account_inactive` |
| 404 | `not_found_error` | `resource_missing`, `route_not_found` |
| 409 | `conflict_error` | `charge_already_succeeded`, `charge_not_succeeded`, `charge_already_refunded`, `insufficient_balance` |
| 422 | `idempotency_error` | `idempotency_key_reused` |
| 429 | `rate_limit_error` | `rate_limited` |
| 500 | `api_error` | `internal_error` — safe to retry with the same Idempotency-Key |

Branch on `code`; `message` is for logs and may change. Every response carries
a `Zapp-Request-Id` — quote it to support.

---

## Operator notes (Zapp internal)

**How money moves.** No API route debits anyone. A charge is paid only in
`approveApiCharge`, under the customer's PIN, with the same guards as a shop
payment: App Check, PIN, post-reset cooldown (`shop_payment`), account status,
velocity, per-transaction + daily/monthly limits. It posts one `online_payment`
entry `apicharge_{chargeId}` (customer → merchant net + `platform:fees`) in the
same transaction that writes the `transactions` row and flips the charge.
Refunds post `refund_apicharge_{chargeId}_{n}`. The nightly invariant check
replays every entry regardless of type, so both are covered.

**Config** (`config/rates`, defaults in `functions/src/config/rates.ts`):
`onlinePaymentFeeRate` (default 0.01), `apiChargeTtlSeconds` (900),
`apiRequestsPerMinute` (120).

**Collections** (all server-only in `firestore.rules`): `merchant_api_keys`
(doc ID = SHA-256 of the key), `api_charges`, `api_refunds`, `api_idempotency`,
`api_rate_limits`, `api_events`, `webhook_endpoints` (secret encrypted with
`ENCRYPTION_KEY`), `webhook_deliveries`.

**Functions:** `api` (HTTPS, behind the Hosting rewrite `/v1/**`),
`getApiCharge`, `approveApiCharge`, `expireApiCharges` (every 5 min),
`onApiChargeWritten` (webhook fan-out), `retryWebhookDeliveries` (every 5 min),
`adminListApiKeys`, `adminIssueApiKey`, `adminRevokeApiKey`.

**Before the first deploy:**

1. `ENCRYPTION_KEY` secret must exist (it already does for the customer-token functions).
2. Deploy indexes first (`firestore.indexes.json`: `api_charges` ×3, `webhook_deliveries` ×1) and wait for them to build.
3. Optional: a Firestore TTL policy on `api_rate_limits.expireAt` so counter docs clean themselves up.
4. Deploy functions, then Hosting (the `/v1/**` and `/checkout/**` rewrites and `checkout.html`).
5. Ship customer-app builds with the `zapppay://` scheme and the charge approval screen **before** handing out keys — older builds can't open `zapppay://` links or recognise checkout QRs.
6. If a custom domain goes in front (`ZAPP_CHECKOUT_BASE_URL`), add it to `isCheckoutHost` in `mobile/src/services/apiCharge.service.ts`.

**Known limits (v1):** no sandbox/test-mode keys (`zpk_test_`); webhook URL
checks refuse internal names and private IPs but don't resolve DNS; universal
links (https → app without the checkout page in between) are not set up.

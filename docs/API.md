# Clasp Public API

Two surfaces, deliberately minimal (PRD §9):

- **First-party app API** at `/api/*` — authenticated by the Pi **session cookie**
  (set after server-side Pi token verification). Used by the reference app.
- **Partner API** at `/api/v1/*` — authenticated by a **Bearer API key**. Anything
  the app can do, a partner integration can do.

---

## Partner API (`/api/v1`)

### Auth
`Authorization: Bearer <key>`. Keys are shown once at creation and stored only as
a SHA-256 hash (`partners.api_key_hash`). Missing/invalid key → `401`.

### `POST /api/v1/partners`
Mint a partner + API key. Guarded by `ADMIN_SECRET` (Bearer) when configured.
```json
{ "name": "Acme Marketplace" }
→ { "partner_id": "...", "name": "...", "tier": "free", "api_key": "clasp_live_…" }
```
The `api_key` is returned **once** — store it securely.

### `POST /api/v1/trades`
Create a trade on behalf of a seller. Body:
```json
{ "amount": 15, "memo": "Sneakers, size 42", "ref": "order-7788",
  "shipWindowS": 259200, "inspectWindowS": 259200,
  "sellerUid": "optional-pi-uid", "sellerUsername": "optional" }
```
Windows default to 72h. Honours an `Idempotency-Key` header. Returns
`{ "trade": {...}, "checkout_url": "https://…/t/{id}" }`.

### `GET /api/v1/trades/:id`
Trade state, deadlines, amounts and event history (partner-scoped).

### `GET /api/v1/trades?ref=<partner-ref>`
Lookup by the partner's own reference id.

### `POST /api/v1/webhooks`
Register a webhook endpoint. Body `{ "url": "https://…", "secret": "whsec_…" }`.

---

## First-party app API (`/api`)

### `POST /api/trades`
Create a trade (seller = the signed-in pioneer). Body:
```json
{ "amount": 12, "shipWindowS": 259200, "inspectWindowS": 259200,
  "memo": "Hand-woven fabric", "ref": "optional" }
```
Returns the trade (including `id`). Checkout URL: `/t/{id}`.
Honours an `Idempotency-Key` header.

### `GET /api/trades/:id`
Current state, deadlines, amounts, event history, proposals, evidence.

### `GET /api/trades?ref=<ref>`
Lookup by reference.

### `POST /api/trades/:id/evidence`
Attach dispute evidence — `{ "caption": "…", "image": "data:image/png;base64,…" }`
(image ≤ 500 KB; a Firebase Storage path in production). Only a party to the trade.

### State transitions (mirror contract functions)
| Path | Caller | Effect |
|---|---|---|
| `POST /api/trades/:id/fund` | buyer | CREATED → FUNDED |
| `POST /api/trades/:id/ship` | seller | FUNDED → SHIPPED (requires `evidenceNote`) |
| `POST /api/trades/:id/confirm` | buyer | SHIPPED → COMPLETED |
| `POST /api/trades/:id/dispute` | buyer | SHIPPED → DISPUTED |
| `POST /api/trades/:id/propose` | party | propose `{ sellerPct }` (5% steps) |
| `POST /api/trades/:id/accept` | counterparty | DISPUTED → SETTLED |
| `POST /api/trades/:id/cancel` | seller | CREATED → CANCELLED |
| `POST /api/trades/:id/timeout` | **anyone** | executes a due deadline transition |

### `GET /api/health`
Status and configuration posture (never secrets).

### Pi payment binding
`POST /api/payments/approve` and `POST /api/payments/complete` are called by the
client during the Pi Wallet flow; both verify with the Pi Platform API
server-side. `POST /api/payments/incomplete` reconciles a payment surfaced by
`onIncompletePaymentFound`.

## Webhooks (PRD §9)

Events: `trade.created`, `trade.funded`, `trade.shipped`, `trade.completed`,
`trade.disputed`, `trade.settlement_proposed`, `trade.settled`, `trade.refunded`,
`trade.nuclear`, `trade.cancelled`.

Delivery: JSON POST with an `X-Clasp-Signature: sha256=<hmac>` header — HMAC-SHA256
of the raw body using the partner's webhook secret; exponential-backoff retries
(5 attempts) via the cron worker; durable outbox in `webhook_deliveries`.

**Source of truth:** webhooks fire from the chain indexer **after** the event is
confirmed on-chain — never from optimistic backend state.

## Standard response envelope

```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": "human-readable message" }
```
`401` = sign in required · `409` = invalid state transition / guard ·
`404` = not found · `400` = validation.

# Clasp Audit — Payment/Escrow Reliability Pass

Date: 2026-07-01 · Auditor: Claude (full-codebase read, no changes made in this phase)
Scope: escrow state machine, payment flow, money math, simulation/chain seam, env vars.
Companion docs: [CLASP-ESCROW-PRD.md](./CLASP-ESCROW-PRD.md) (money model source of truth), [SECURITY_AUDIT_REPORT.md](./SECURITY_AUDIT_REPORT.md).

---

## 0. Brief vs reality — read this first

The task brief encodes several assumptions that no longer match the shipped app. The
code and PRD in this repo are the source of truth; the audit documents reality.

| Brief says | Reality | Where decided |
|---|---|---|
| "non-custodial escrow" | **Custodial.** Buyer/seller funds arrive in the App Wallet via U2A `Pi.createPayment`; releases are A2U payouts signed by `PI_WALLET_PRIVATE_SEED`. The Soroban contract exists (`contract/`) but is not connected, and the Pi JS SDK exposes no wallet-signed contract calls, so a non-custodial flow is not currently possible on Pi (documented in `lib/chain.ts:9-14`). | PRD §1; lib/chain.ts |
| "15% dispute bonds" | **10% security bond** (floor 1 π), posted by both parties. Changed by owner instruction 2026-07-01. | escrow.ts:28; PRD §1 |
| "1.5% transaction fee on seller proceeds only" | **1.5% commission (floor 0.05 π) collected up front from a chosen fee payer** (seller at creation or buyer at funding), held in escrow, released to the operator only on COMPLETED/SETTLED, refunded on REFUNDED/NUCLEAR. Never carved out of the price. | escrow.ts:103-186; PRD §1 |
| "integer stroops (7 decimal places)" | Integer **micro-Pi (6 dp)** everywhere (`1 π = 1_000_000 µπ`). Same property (no float arithmetic on money); converting to 7-dp stroops would churn every stored amount for no gain. Floats appear only at the Pi API boundary, which itself takes Pi-denominated floats. **Intentional divergence — keep micro-Pi.** | escrow.ts:14-22 |
| "23 passing e2e tests" | The suite is `scripts/lifecycle.sh` (11 checks) + `scripts/features.sh` (14 checks) = **25 checks**. As of this audit they are expected to be **RED**: both scripts fund trades without posting the new mandatory seller bond (finding F1). | scripts/ |
| "`PI_API_KEY` and `PI_APP_ID`" | **`PI_APP_ID` is not a thing in this integration.** The Pi Platform API authenticates with `Authorization: Key <PI_API_KEY>` only; no route reads `PI_APP_ID`. App identity is bound by the Developer Portal registration + verified domain. | lib/pi-server.ts:13-21 |
| "Firebase/Vercel env var gap caused the payment failure" | The production payment failure was **not** an env-name gap. Root cause (proven from Vercel runtime logs + direct Pi API probes): `GET /v2/payments/{id}` returned 404 because the deployed `PI_VALIDATION_KEY` belonged to a different portal app and the domain was unverified, so SDK payments were not bound to the app `PI_API_KEY` could see. Fixed by registering `claspescrow.com`, serving the correct validation key, and verifying the domain. | SECURITY_AUDIT_REPORT.md (follow-up section) |

---

## 1. Escrow state machine

Engine: `lib/store.ts` (the only writer of trade state). Rules mirrored from
`contract/src/lib.rs`. Repo-agnostic via `lib/db/repo.ts`.

### States
`CREATED → FUNDED → SHIPPED → COMPLETED | DISPUTED`, `DISPUTED → SETTLED | NUCLEAR`,
`CREATED → CANCELLED`, `FUNDED → REFUNDED`. Terminal: `COMPLETED, SETTLED, REFUNDED,
CANCELLED, NUCLEAR` (escrow.ts:56-62).

### Transitions and guards

| Transition | Function (store.ts) | Guards |
|---|---|---|
| ∅ → CREATED | `createTrade` (:251) | zod bounds + `validateCreate` (amount floor 1 π, per-tier cap, window bounds); seller session; rate limit 20/min/user. Starts with `seller_bond_paid=false`. |
| CREATED bond flag | `bondTrade` (:296) | seller only; state CREATED; idempotent replay; sets `seller_bond_paid`, emits `trade.bonded`. |
| CREATED → FUNDED | `fundTrade` (:319) | state CREATED; funding deadline not passed; buyer ≠ seller; **seller bond posted**; idempotent replay for same buyer. |
| FUNDED → SHIPPED | `markShipped` (:341) | seller only; ship deadline not passed; evidence required. |
| SHIPPED → COMPLETED | `confirmReceipt` (:356) → `complete()` | buyer only. Also auto via timeout (silence). Enqueues payouts. |
| SHIPPED → DISPUTED | `openDispute` (:364) | buyer only; inspect deadline not passed; marks `disputed=true`. |
| DISPUTED proposal | `proposeSettlement` (:381) | party only; settlement window open; 5% increments; supersedes open proposals. |
| DISPUTED → SETTLED | `acceptSettlement` (:403) | counterparty (not proposer); proposal open. Enqueues payouts. |
| CREATED → CANCELLED | `cancelUnfunded` (:420) | seller anytime; anyone after funding deadline. |
| CANCELLED → CREATED | `reactivateTrade` (:437) | seller only; never-funded only (no buyer). Fresh 24 h window. |
| Timeouts (permissionless) | `advanceTimeouts` (:505) | CREATED+deadline→CANCELLED; FUNDED+deadline→REFUNDED; SHIPPED+deadline→COMPLETED; DISPUTED+deadline→NUCLEAR. Runs lazily on every read. |

Illegal transitions throw `TransitionError` → HTTP 409 (`lib/api.ts:46`). Typed, as
the brief requires — already satisfied.

### Atomicity — the real weakness (finding F2)
Every transition is **read → mutate in memory → `saveTrade` (plain `set()`) →
`addEvent` → `notify`**, i.e. multi-step non-transactional writes
(firestore-repo.ts:52-57). Two concurrent requests can interleave (double-fund race:
two buyers pass the CREATED check before either save lands; lazy timeout racing a
manual action). There is **no Firestore transaction** and **no `state_history`
subcollection** (events in `trade_events` serve as an informal audit trail but are
written after, not with, the state change).

---

## 2. Payment flow, end to end

### Money in (U2A, custodial)
1. Client (`lib/pi-client.ts:110-151` `createPayment`): awaits `Pi.init` →
   `authenticate(['username','payments'])`, awaits reconcile of any incomplete
   payment, then `Pi.createPayment(amount, memo, metadata:{tradeId, kind})`.
   Two kinds: `seller_bond` (create page / trade page "pay deposit") and
   `escrow_lock` (checkout `app/t/[id]`).
2. `onReadyForServerApproval` → `POST /api/payments/approve`
   (approve/route.ts): session required; bond payments seller-only; re-derives the
   **expected amount server-side** (`sellerLockTotal` / `buyerLockTotal` — client
   cannot dictate amounts); `GET /v2/payments/{id}` (12 s timeout) with explicit
   404 diagnosis; amount mismatch → 409; then `POST /v2/payments/{id}/approve`.
3. User signs in Pi Wallet → funds move to the App Wallet on testnet chain.
4. `onReadyForServerCompletion` → `POST /api/payments/complete`
   (complete/route.ts): `POST /v2/payments/{id}/complete` with txid, then
   `bondTrade` or `fundTrade`. A fund failure after Pi-complete is logged loudly as
   requiring reconciliation (the "money moved, no record" failure previously hit in
   prod) — but recovery is still manual (finding F3).
5. Incomplete payments: `onIncompletePaymentFound` → `POST /api/payments/incomplete`
   (rate-limited 20/min/IP) → complete-if-txid else cancel. Admin sweeper:
   `GET/POST /api/admin/payments` (constant-time bearer).

### Money out (A2U, the custodial release)
`lib/payouts.ts` + `lib/pi-payout.ts` (official `pi-backend` SDK, gated on
`PI_API_KEY` + `PI_WALLET_PRIVATE_SEED`):
- On any funded-terminal transition, `enqueuePayoutsForTrade` writes idempotent
  `payouts` docs (`id = tradeId:role`).
- `processPendingPayouts` (cron `/api/cron/payouts` + admin `/api/admin/payouts`)
  drains them with a resumable create→submit→complete cycle, persisting
  `payment_id` then `txid` after each step, adopting an existing txid on retry
  (no double-pay), honouring Pi's one-incomplete-A2U rule, `MAX_ATTEMPTS=5`.

### Verification logging (finding F4)
Approve/complete attempts log to console (Vercel logs) with payment id, expected
amount, status — but are **not persisted** to the database as the brief requires
(request id, response status, timestamp queryable per trade).

---

## 3. Money math inventory

Canonical module: `lib/escrow.ts`. All arithmetic on `bigint` micro-Pi; floats only
at UI/Pi-API edges via `piToMicro`/`microToPi` (:16-22, round-to-nearest).

| Site | What |
|---|---|
| escrow.ts:25-42 `PARAMS` | BOND_PCT 10%, BOND_FLOOR 1 π, FEE_PCT 15/1000, FEE_MIN 0.05 π, AMOUNT_FLOOR 1 π, windows |
| escrow.ts:84-87 `bondFor` | max(10%, 1 π) |
| escrow.ts:89-93 `feeFor` | max(1.5%, 0.05 π), 0 for ≤0 |
| escrow.ts:103-105 `sellerLockTotal` | bond + fee-if-seller-pays (seller's up-front deposit) |
| escrow.ts:109-111 `buyerLockTotal` | price + bond + fee-if-buyer-pays |
| escrow.ts:129-137 `completedPayout` | seller: price+bond; buyer: bond; operator keeps held fee |
| escrow.ts:142-153 `refundedPayout` | bonds back + prepaid fee refunded to its payer; no fee |
| escrow.ts:158-168 `settledPayout` | sellerPct split + bonds back; fee kept; dust→buyer |
| escrow.ts:175-186 `nuclearPayout` | 50/50 split (dust→buyer), bonds burned, prepaid fee refunded |
| store.ts:255-266 | persists bond/fee snapshots on the trade |
| payouts.ts:29-47 | payout amounts from the four outcome functions (passes `fee_payer` ✓) |
| approve/route.ts:69-73 | server-side expected-amount enforcement (passes `fee_payer` ✓) |
| app/create/page.tsx:50-67, app/t/[id]/page.tsx:47-50, app/trade/[id]/page.tsx:372-434 | display math (passes `fee_payer` ✓) |
| **app/dispute/[id]/page.tsx:46-47** | **BUG (F5): `settledPayout(amount, pct)` and `nuclearPayout(amount)` called WITHOUT `trade.fee_payer`** → preview numbers wrong for buyer-pays trades (defaults to seller-pays). Payout engine is unaffected (it passes fee_payer), display only. |

**No unit tests exist for any of this** (finding F6). The only automated coverage is
the two curl-based e2e scripts.

---

## 4. Simulation/chain seam

- `lib/chain.ts` is a descriptor-builder stub gated on `NEXT_PUBLIC_CONTRACT_ADDRESS`;
  documents the hard blocker: the public Pi JS SDK cannot sign contract calls, so
  WRITES cannot be activated regardless of deployment.
- `lib/store.ts` importers: **API route handlers and `lib/api.ts` only.** No file
  under `app/**/page.tsx` or `components/**` imports it; the UI talks exclusively to
  `lib/client-api.ts` (fetch wrappers). **The seam is clean as specified.**
- One conceptual leak: UI pages import pure math from `lib/escrow.ts` (display
  only). That is the shared rules module, not the engine — acceptable and identical
  to what the contract mirrors.

---

## 5. Environment variables

### Server-only (verified read sites)
| Var | Read at | Required for | In .env.example |
|---|---|---|---|
| `PI_API_KEY` | pi-server.ts:14, pi-payout.ts:20, partners.ts:16, several routes | all Pi platform calls | ✓ |
| `PI_API_BASE` | pi-server.ts:13 | override only (defaults api.minepi.com) | ✓ |
| `PI_VALIDATION_KEY` | validation-key.txt route | domain verification | ✓ |
| `PI_WALLET_PRIVATE_SEED` | pi-payout.ts:21 | A2U payouts (escrow release) | ✓ |
| `SESSION_SECRET` | session.ts:20 | cookie signing (fails closed in prod) | ✓ |
| `FIREBASE_PROJECT_ID/_CLIENT_EMAIL/_PRIVATE_KEY` | firebase.ts | Firestore | ✓ |
| `FIRESTORE_EMULATOR_HOST` | firebase.ts | local dev | ✓ |
| `ADMIN_SECRET` | admin/payments, admin/payouts, v1/partners | admin + key issuance | ✓ |
| `CRON_SECRET` | cron/reminders:17, cron/payouts:16 | cron auth | ✓ |
| `APP_URL` | v1/trades:21 | partner checkout links | ✓ |
| `RATE_LIMIT_DISABLED` | api.ts:27 | test/CI bypass | **✗ missing** |
| `PI_RPC_URL`, `PI_TOKEN_SAC` | chain.ts:25-26 | future contract reads | **✗ missing** |

### Client-exposed (`NEXT_PUBLIC_*`)
| Var | Read at | Note |
|---|---|---|
| `NEXT_PUBLIC_PI_SANDBOX` | pi-client.ts:53, health route | the single network-mode flag (desktop sandbox vs Pi Browser); correctly NOT a testnet/mainnet switch |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | chain.ts:24, trust page | unset until contract cutover |
| `NEXT_PUBLIC_PI_EXPLORER_BASE` | **read nowhere** — listed in .env.example but dead (F7) |

### Gaps / misconfig risks
- **No startup guard**: a missing `SESSION_SECRET` in prod surfaces only on first
  cookie signing; missing Firebase vars silently fall back to `MemoryRepo` — on
  Vercel serverless that means **trades written to instance memory and lost**,
  which is exactly the "trade vanished" class of failure. Fail-fast wanted (F8).
- Hardcoded network strings (Phase 3 item 5): explorer URL hardcoded to
  `/mainnet/` in app/trade/[id]/page.tsx:487 while the env override
  `NEXT_PUBLIC_PI_EXPLORER_BASE` is unused (F7); `PI_RPC_URL` default in chain.ts
  points at mainnet RPC (dormant code path).

---

## 6. Findings → Phase 2 worklist

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | **High** | e2e scripts don't post the now-mandatory seller bond → suite red; also `features.sh` partner-created trades produce checkouts buyers can't pay (no bond flow for partner sellers) | update scripts to call `/bond`; decide + document partner-trade bond policy |
| F2 | **High** | No atomic transitions; races (double-fund, timeout-vs-action) can corrupt escrow state; no per-trade state history | run transitions in Firestore transactions (`runTransaction` with state re-check inside), add `state_history` subcollection written in the same transaction |
| F3 | **High** | Pi-complete succeeds but local record fails → money moved, no trade record; recovery manual | persist a durable `payment_intents` record BEFORE Pi-complete keyed by paymentId (retryable), so reconciliation is automatic |
| F4 | Medium | Verification attempts not persisted (console only) | log approve/complete attempts to a `payment_logs` collection: request id, payment id, trade id, response status, timestamp |
| F5 | Medium | Dispute page previews ignore `fee_payer` (dispute/[id]/page.tsx:46-47) | pass `trade.fee_payer` |
| F6 | Medium | Zero unit tests for money math | add unit tests: 0, dust, floor boundaries (1 π bond floor at ≤10 π, 0.05 π fee floor at ≤3.33 π), max amounts, rounding, payout-solvency invariant (Σ payouts + kept fee = Σ collected) per outcome × fee payer |
| F7 | Low | `NEXT_PUBLIC_PI_EXPLORER_BASE` dead; explorer URL hardcoded mainnet | wire the env var (testnet default) into the event log link |
| F8 | Medium | No env startup guard; Memory fallback on serverless silently loses data | fail-fast validator on server bootstrap with a clear message naming each missing/malformed var; refuse Memory fallback when `VERCEL===1` |
| F9 | Low | No Pi-verification retry with idempotency key | retry getPayment/approve once on network error (approve POST is idempotent server-side because expected-amount check re-runs) |
| F10 | Info | `.env.example` missing `RATE_LIMIT_DISABLED`, `PI_RPC_URL`, `PI_TOKEN_SAC` | document |

---

## 7. Phase 3 checklist — Pi SDK and Testnet readiness

Verified during this audit; each will be re-confirmed (and gaps closed) in Phase 3.

| Item | Status |
|---|---|
| 1. Minimal `Pi.authenticate` scopes | ✅ Sign-in requests only `username` (pi-client.ts:92); `payments` is added just-in-time at payment (pi-client.ts:122). `wallet_address` type exists but is never requested. |
| 2. All `createPayment` callbacks handled | ✅ handled (pi-client.ts:135-148 → both pages); ⚠ outcomes not persisted server-side (F4) — cancel/error only reach client state |
| 3. `onIncompletePaymentFound` resolved server-side | ✅ pi-client.ts:92-102 + /api/payments/incomplete (complete-if-txid else cancel) |
| 4. Server routes validate auth before Pi API calls | ✅ session cookie required (`requireSession`) on approve/complete; the session is only minted after `GET /v2/me` verification of the access token (auth/route.ts:38). The brief's literal ask (re-send the Pi access token per request) would add nothing over the signed cookie and would push tokens into more requests; flagged as intentionally different. |
| 5. Single `NEXT_PUBLIC_PI_SANDBOX` flag, no other hardcoded network refs | ⚠ flag is single (pi-client.ts:53) but explorer link hardcodes `/mainnet/` (F7); chain.ts default RPC is mainnet (dormant) |
| Pi2Day 2026 releases | To review in Phase 3: **Pi Sign-in** (may replace the polling `window.Pi` detect + enable auth outside Pi Browser), **PiVerify** (KYC attestation could gate high-tier sellers without our own checks), **SoloHost** (self-hosting requirement changes). Flag only, no integration this pass. |

---

## 8. What Phase 4 must not break

- The trade/checkout pages embed payment flows with strict server-side amount
  checks; redesign changes presentation only, never the amounts sent to
  `Pi.createPayment`.
- Pi Browser ≈ 380 px; session cookie is `Partitioned` (third-party iframe on
  pinet.com) — do not move auth to localStorage.
- `prefers-reduced-motion`, WCAG AA on dark background, no horizontal scroll.

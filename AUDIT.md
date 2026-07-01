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

## 6. Findings → Phase 2 worklist (all resolved 2026-07-01)

| # | Severity | Finding | Resolution |
|---|---|---|---|
| F1 | **High** | e2e scripts don't post the now-mandatory seller bond → suite red | ✅ FIXED — scripts post `/bond` where funding follows; new checks: bond-gate rejection, bond step, cancel→reactivate. Partner-trade policy documented: a partner-created trade stays unfundable until its seller opens Clasp and posts the bond (checkout blocks it). Suite: 15+14 = 29 green. |
| F2 | **High** | No atomic transitions; double-fund and timeout-vs-action races; no per-trade state history | ✅ FIXED — `repo().runTradeTransition` runs guards+mutation inside a Firestore transaction (per-trade lock in MemoryRepo); trade doc + `state_history` row commit together; timeouts re-check inside and no-op on races (store.ts, firestore-repo.ts, memory-repo.ts). |
| F3 | **High** | Pi-complete succeeds but local record fails → money moved, no trade record | ✅ FIXED — complete route persists a `payment_intents` doc (status `completing`) before acknowledging Pi; `lib/reconcile.ts` replays the idempotent bond/fund transition for anything stuck past 2 minutes; wired into the payouts cron. |
| F4 | Medium | Verification attempts not persisted | ✅ FIXED — `payment_logs` collection via `lib/payment-audit.ts`: request id, phase (approve/complete/reconcile/client), payment id, trade id, status, detail, timestamp. |
| F5 | Medium | Dispute previews ignore `fee_payer` | ✅ FIXED — dispute page passes `trade.fee_payer` to both preview functions. |
| F6 | Medium | Zero unit tests for money math | ✅ FIXED — `tests/money.test.ts` (12 tests, `npm run test:unit`): floors, boundaries, rounding, dust-to-buyer, and the solvency invariant across every outcome × fee payer × 9 amounts. |
| F7 | Low | Explorer URL hardcoded mainnet; env var dead | ✅ FIXED — event-log link uses `NEXT_PUBLIC_PI_EXPLORER_BASE` (testnet default); `.env.example` updated; dormant `chain.ts` RPC default flipped to testnet. |
| F8 | Medium | No env startup guard; silent Memory fallback on serverless | ✅ FIXED — `lib/env-guard.ts` runs once from the shared `handler()`: prod fails fast listing every missing/malformed var, and refuses to run on Vercel without Firestore. |
| F9 | Low | No Pi-verification retry | ✅ FIXED — `piFetch` in pi-server.ts retries once on network failure only (never on HTTP status); approve/complete are idempotent per payment id, request ids correlate the log rows. |
| F10 | Info | `.env.example` gaps | ✅ FIXED — `RATE_LIMIT_DISABLED`, `PI_RPC_URL`, `PI_TOKEN_SAC` documented. |

Also fixed while in here: the payouts worker (`/api/cron/payouts`) existed but was
never scheduled in `vercel.json` — escrow releases would have waited for a manual
admin call forever. Now scheduled daily, plus an opportunistic best-effort drain
fires immediately after every settlement (`kickPayouts`), with the resumable
payout cycle making either path safe to kill mid-flight.

---

## 7. Phase 3 checklist — Pi SDK and Testnet readiness (completed 2026-07-01)

| Item | Status |
|---|---|
| 1. Minimal `Pi.authenticate` scopes | ✅ DONE — sign-in requests only `username`; `payments` is added just-in-time at the moment of payment. `wallet_address` is never requested. No change needed. |
| 2. All `createPayment` callbacks handled and persisted | ✅ DONE — approval/completion outcomes were already persisted via the server routes; cancel/error outcomes now persist too: the SDK wrapper reports them to `POST /api/payments/outcome` (session-gated, rate-limited, diagnostics-only), landing in `payment_logs` with phase `client`. |
| 3. `onIncompletePaymentFound` resolved server-side | ✅ DONE — both authenticate paths post the stale payment to `/api/payments/incomplete`, which completes it when a txid exists and cancels it otherwise; `createPayment` awaits that reconcile before opening a new payment. |
| 4. Server routes validate auth before Pi API calls | ✅ DONE (intentionally different mechanism) — every payment route requires the signed session cookie, and a session is only ever minted after the access token passes `GET /v2/me` verification. Re-sending the raw Pi access token per request would spread the token wider for no security gain; documented here as the deliberate design. |
| 5. Single `NEXT_PUBLIC_PI_SANDBOX` flag, no other hardcoded network refs | ✅ DONE — the flag is the only network-mode switch; the explorer link now uses `NEXT_PUBLIC_PI_EXPLORER_BASE` (testnet default) and the dormant `chain.ts` RPC default now points at testnet. Reminder: this flag selects the desktop dev sandbox, NOT Testnet vs Mainnet — the portal registration does that. |

### Pi2Day 2026 releases — flagged, not integrated (per the brief)

Source: the [official Pi2Day 2026 announcement](https://minepi.com/blog/pi2day2026/)
(see also [KuCoin's coverage](https://www.kucoin.com/news/flash/pi-network-launches-solohost-pi-sign-in-and-piverify-on-pi2day-2026)).

| Release | What it is | Constraint it could remove for Clasp |
|---|---|---|
| **Pi Sign-in** | Pi-account sign-in for third-party apps OUTSIDE the Pi Browser | Today Clasp auth only works inside Pi Browser (the app polls for `window.Pi` and falls back to a sandbox identity). Pi Sign-in could let sellers manage trades from a normal desktop browser — notifications, dispute handling, partner dashboards — with payments still happening in Pi Browser. Biggest practical win of the three. |
| **PiVerify** | Pi's real-human/KYC verification offered to third-party clients (18M+ verified users) | Seller trust tiers currently derive only from in-app trade history. A PiVerify attestation could gate the higher tiers (or lower bonds for verified sellers) without Clasp running any identity checks itself. |
| **SoloHost** | Permissionless publishing of Node-based, self-hosted apps on Pi Desktop | Least relevant near-term: Clasp is a hosted web app on Vercel. Worth watching if Pi later privileges SoloHost distribution or offers compute Clasp could use for the indexer. |

No integration in this pass. When Pi Sign-in SDK docs stabilize, it should be the
first of the three to evaluate.

---

## 8. What Phase 4 must not break

- The trade/checkout pages embed payment flows with strict server-side amount
  checks; redesign changes presentation only, never the amounts sent to
  `Pi.createPayment`.
- Pi Browser ≈ 380 px; session cookie is `Partitioned` (third-party iframe on
  pinet.com) — do not move auth to localStorage.
- `prefers-reduced-motion`, WCAG AA on dark background, no horizontal scroll.

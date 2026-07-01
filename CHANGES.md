# Changes — Payment/Escrow Reliability Pass + UI Redesign

Date: 2026-07-01. One section per phase. Companion detail lives in
[AUDIT.md](./AUDIT.md); the money model source of truth is
[CLASP-ESCROW-PRD.md](./CLASP-ESCROW-PRD.md).

---

## Phase 1 — Audit

- Wrote `AUDIT.md`: the full escrow state machine (states, transitions, guards,
  file references), the end-to-end payment flow (U2A funding in, custodial A2U
  payouts back out), every money-math site, the `lib/store.ts` / `lib/chain.ts`
  seam, and the complete env-var inventory versus `.env.example`.
- Documented where the task brief had drifted from the shipped app: the app is
  custodial (the Pi JS SDK cannot sign contract calls), bonds are 10% not 15%,
  the 1.5% commission is collected up front and held in escrow rather than
  carved from seller proceeds, amounts are integer micro-Pi (6 dp) not stroops,
  `PI_APP_ID` is not a real integration variable, and the production payment
  failure was an app-identity mismatch in the Pi portal, not a Firebase env gap.
- Confirmed the seam is clean: no UI file imports the store; only API routes do.

## Phase 2 — Payment and escrow hardening

- **Atomic transitions.** Every state change now runs inside a Firestore
  transaction (`runTradeTransition`): guards execute against the freshly read
  trade, and the trade document commits together with a new `state_history`
  audit row or not at all. The memory backend mirrors this with a per-trade
  lock. Double-fund and timeout-versus-action races now resolve to exactly one
  winner; permissionless timeouts re-check inside the transaction and no-op
  when someone else got there first. Illegal transitions throw a typed
  `TransitionError` (HTTP 409), now housed in `lib/errors.ts`.
- **Self-healing completions.** The complete route persists a durable
  `payment_intents` record before acknowledging the payment with Pi; the trade
  write happens after. If that write dies, `lib/reconcile.ts` finds the stuck
  intent, re-checks the payment with Pi, and replays the idempotent bond/fund
  transition. The class of failure where Test-Pi left a wallet with no trade
  record can no longer lose money silently.
- **Verification audit trail.** Every approve, complete, reconcile, and
  client-side cancel/error attempt lands in a `payment_logs` collection with a
  request id, phase, payment id, trade id, outcome status, and timestamp.
- **Network resilience.** Server calls to the Pi API retry once on network
  failure only (never on an HTTP status); approve and complete are idempotent
  per payment id, so the retry cannot double-move funds.
- **Fail-fast environment guard.** `lib/env-guard.ts` runs once per instance
  and refuses to serve with a missing/short `SESSION_SECRET` in production, a
  malformed wallet seed or Firebase key, or (the big one) no Firestore on
  Vercel, where the silent in-memory fallback used to eat trades.
- **Money math.** Verified against the PRD (10% bonds both sides, 1.5%
  commission held up front, dust to the buyer, burns on nuclear). Fixed the
  dispute screen previews ignoring the commission payer. Added
  `tests/money.test.ts` (12 tests, `npm run test:unit`, zero new frameworks):
  floors, boundaries, rounding, dust, and a solvency invariant proving payouts
  plus kept commission plus burns equal exactly what was collected, for every
  outcome and payer across nine amounts.
- **Payout plumbing found dormant.** The payouts worker existed but was never
  scheduled; it is now in `vercel.json` (daily) and settlements also trigger an
  immediate best-effort drain, safe to kill mid-flight because every payout
  step persists before the next.
- **Test suite repaired and extended.** The e2e scripts now post the mandatory
  seller bond, and cover the bond gate rejection and cancel-then-reactivate.
  29 e2e checks + 12 unit tests, all green (output below).

## Phase 3 — Pi SDK and Testnet readiness

- Scopes are minimal: `username` at sign-in, `payments` only at the moment of
  payment. Incomplete payments resolve server-side on login and before any new
  payment. All payment routes require the signed session (minted only after
  `GET /v2/me` verification); this is deliberately a session check rather than
  re-sending raw access tokens per request, documented in AUDIT.md.
- Client-side `onCancel`/`onError` outcomes now persist through a new
  session-gated `POST /api/payments/outcome` endpoint.
- The last hardcoded network references are gone: the explorer link respects
  `NEXT_PUBLIC_PI_EXPLORER_BASE` (testnet default) and the dormant RPC default
  now points at testnet.
- Pi2Day 2026 releases flagged in AUDIT.md, not integrated: Pi Sign-in (would
  unlock trade management outside Pi Browser), PiVerify (KYC attestation could
  gate seller tiers), SoloHost (not relevant to a hosted web app today).

## Phase 4 — UI redesign

- **Design system.** The token layer flipped to a dark blue-black ground with
  signal cyan `#1FC6FF` as the single accent. Flat surfaces only, no gradients;
  depth comes from elevation and restrained cyan glow shadows. Contrast checked
  against WCAG AA (including dark ink text on cyan buttons, which white text
  would have failed). All animation collapses under `prefers-reduced-motion`,
  and every interactive element has a visible keyboard focus ring. A hex
  ground-grid texture (inline SVG, no asset) and neon wireframe illustrations
  carry the visual identity.
- **Splash.** Three swipeable cards on first launch: what Clasp is, a trade in
  three beats, why honesty wins. Swipe on touch, arrow keys on desktop, dots,
  Skip on every card, remembered per device.
- **Payment checkout.** A live three-step tracker (awaiting Pi approval,
  submitting to the Pi network, confirmed), each step with its own icon and
  microcopy. The current step persists per trade, so backgrounding Pi Browser
  and returning resumes the tracker where it was. Dispute terms sit in one
  collapsible line; the lock button is the only primary action.
- **Live tracking.** Trade pages subscribe to a Server-Sent Events stream
  backed by a real Firestore listener (interval diffing only in local dev).
  Both parties watch the same timeline move without refreshing; a dropped
  stream resyncs on reconnect and on tab focus. The timeline now shows a
  timestamp and actor on every reached node and pulses the current one.
- **Confetti.** Clean completions fire a two-burst canvas confetti in brand
  colors, exactly once per trade per party, never on disputes, refunds, or
  nuclear outcomes, and never under reduced motion. (canvas-confetti was added
  for this; the brief specified a lightweight canvas confetti library.)
- Verified in a live 380px session: splash cards and dismissal, dashboard,
  checkout with correct totals (25 π item, buyer pays: 27.875 π), tracker
  resume after a full page reload, SSE-driven auto-advance to the funded trade
  view with no user action, completed timeline, one-time confetti, and no
  horizontal scroll.

---

## Test run (final, after all phases)

```
════════ UNIT TESTS (npm run test:unit) ════════
ℹ tests 12
ℹ pass 12
ℹ fail 0

════════ E2E: lifecycle.sh ════════
=== HAPPY PATH (create→fund→ship→confirm) ===
PASS  created (CREATED)
PASS  fund before seller bond rejected (False)
PASS  seller bond posted (CREATED)
PASS  fund→FUNDED (FUNDED)
PASS  ship→SHIPPED (SHIPPED)
PASS  confirm→COMPLETED (COMPLETED)
=== DISPUTE → SETTLE ===
PASS  dispute→DISPUTED (DISPUTED)
PASS  accept→SETTLED (SETTLED)
=== AUTHORIZATION GUARDS ===
PASS  seller cannot confirm (False)
PASS  seller cannot fund own trade (False)
=== CANCEL → REACTIVATE ===
PASS  cancel→CANCELLED (CANCELLED)
PASS  reactivate→CREATED (CREATED)
=== AMOUNT BOUNDS (Starter tier = 100 Pi cap) ===
PASS  60 Pi within new Starter cap (True)
PASS  over 100 Pi Starter cap rejected (False)
PASS  under 1 Pi floor rejected (False)
15 passed, 0 failed

════════ E2E: features.sh ════════
=== IDEMPOTENCY (POST /api/trades) ===
PASS  replay returns same trade id
=== PARTNER API + WEBHOOK (signed) ===
PASS  partner issuance denied without admin (401)
PASS  partner key issued (with admin) (clasp_test_)
PASS  webhook registered (signed) (True)
PASS  partner trade has checkout url (1)
PASS  partner idempotent replay
PASS  lookup by ref
PASS  partner GET trade (CREATED)
PASS  v1 requires api key (401)
PASS  webhook event is trade.created (trade.created)
PASS  webhook HMAC signature valid
=== EVIDENCE UPLOAD (dispute) ===
PASS  buyer can add evidence (201)
PASS  evidence appears on trade (1)
PASS  non-party evidence rejected (409)
14 passed, 0 failed
```

41 checks green: 12 unit, 29 end to end.

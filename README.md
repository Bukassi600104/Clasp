# Clasp

_The payment trust layer for Pi commerce. (Working title — formerly "Clasp", renamed to avoid a collision with the existing Clasp DeFi app.)_

**The payment trust layer for Pi commerce.** Sell anywhere, get paid safely —
nobody holds the money but the blockchain.

Clasp is a non-custodial escrow app for the Pi Network. A buyer locks Pi
(price + a small refundable bond); the seller ships; the buyer confirms and the
funds release. If anything goes wrong, the two parties settle on-chain — **no
operator ever decides an outcome or touches the funds**.

This repository is the **reference app + public API** (Layers 2 & 3 of the
[PRD](./PIBRIDGE-ESCROW-PRD.md)). It is a Pi Browser web app built with Next.js.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind — flat, trust-forward design (no gradients) |
| Backend | Next.js API routes on Vercel |
| Data | Firebase Firestore via firebase-admin (server-only). Falls back to an in-memory engine when unconfigured, so the UI is fully explorable on first boot. Use the Firestore emulator locally. |
| Auth | Pi SDK authentication only (no email/password) |
| Payments | Pi SDK wallet flow, approved & completed server-side with the secret Pi Platform API key |
| Notifications | In-app center + (Resend email, optional) + Vercel Cron deadline reminders |
| Contract | Rust/Soroban escrow contract on Pi mainnet (separate build sessions — see PRD §13). The app talks to it through `lib/store.ts`, the single seam to swap the in-process engine for the real chain indexer. |

## Design principles enforced in code

- **Non-custodial:** the backend displays, reminds, and records — it never
  decides. Every fund movement maps to a user-signed contract call or a
  permissionless timeout (`lib/store.ts`).
- **Pi only:** all amounts are shown in Pi (`π`). No fiat, no price commentary.
- **No keys, ever:** signing happens in Pi Wallet. The app handles access tokens
  and payment ids only.
- **Integer money math:** amounts are micro-Pi `bigint` throughout; dust goes to
  the buyer (`lib/escrow.ts`).

---

## Local development

```bash
npm install
cp .env.example .env        # fill in values, or leave blank for sandbox mode
npm run dev                 # http://localhost:3000
```

With **no** `PI_API_KEY` set, the app runs in **sandbox mode**: a generated
identity stands in for Pi auth and a few demo trades are seeded so every screen
(home, create, checkout, trade detail, dispute room, profile, activity) is
explorable in a normal browser.

### Run against real Firestore locally (emulator)

```bash
npm run emulator            # Firestore emulator on :8080 (needs Java/JRE)
# in a second shell:
FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=clasp-local npm run dev
```
`GET /api/health` then reports `"persistence":"firestore"`.

### Verify the whole system

```bash
npm run build && PORT=3100 npm run start &   # production server
npm run verify                               # 23 end-to-end checks
```

- `scripts/lifecycle.sh` (10) — happy path, dispute → settlement, authorization
  guards, amount bounds; asserts state transitions + money math against PRD §8.
- `scripts/features.sh` (13) — Idempotency-Key, partner API key issuance, partner
  trade creation, webhook delivery with an **openssl-verified HMAC signature**,
  and dispute evidence upload + authorization.
- `scripts/fs-count.mjs` — counts persisted Firestore documents (via the admin
  SDK) to prove data survives in the database.

All 23 pass on both the in-memory and Firestore backends.

---

## Environment variables

See [`.env.example`](./.env.example). Summary:

| Var | Purpose | Required for mainnet |
|---|---|---|
| `PI_API_KEY` | Secret Pi Platform API key (server only) | ✅ |
| `PI_VALIDATION_KEY` | Served at `/validation-key.txt` for Pi Developer Portal | ✅ |
| `NEXT_PUBLIC_PI_SANDBOX` | `Pi.init` sandbox flag. `false`/unset for the real Pi Browser (both Testnet AND Mainnet); `true` only for desktop `sandbox.minepi.com` dev. Network is set by portal registration, NOT this flag. | ✅ |
| `SESSION_SECRET` | Signs the session cookie | ✅ |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Firestore persistence (required on serverless) | ✅ |
| `FIRESTORE_EMULATOR_HOST` | Local emulator instead of prod Firestore | dev only |
| `ADMIN_SECRET` | Guards partner API-key issuance (`POST /api/v1/partners`) | recommended |
| `CRON_SECRET` | Protects the reminder + webhook-retry cron endpoint | recommended |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Published everywhere to fight phishing clones | ✅ |

---

## Deploying to the Pi ecosystem

1. **Database (recommended for production — required on serverless).** Create a
   Firebase project, enable Firestore, generate a service-account key, and set
   `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`.
   Collections are created on first write — no migration step. Locally, run the
   Firestore emulator and set `FIRESTORE_EMULATOR_HOST=localhost:8080`.
2. **Deploy.** Push to Vercel (`vercel deploy`). `vercel.json` registers the
   hourly deadline-reminder cron.
3. **Pi Developer Portal.** Register the app, set the secret API key as
   `PI_API_KEY`, and host the domain validation key by setting
   `PI_VALIDATION_KEY` (served at `https://<domain>/validation-key.txt`).
4. **Testnet first.** Register the portal app on **Pi Testnet** and use that
   app's `PI_API_KEY`. Keep `NEXT_PUBLIC_PI_SANDBOX` unset/false — in the real Pi
   Browser the SDK connects to your app's registered network automatically (the
   sandbox flag is only for desktop `sandbox.minepi.com` testing). Pass the PRD
   §12 gates before mainnet.
5. **Mainnet.** Register a separate Mainnet portal app, swap in its `PI_API_KEY`,
   deploy the audited contract, set `NEXT_PUBLIC_CONTRACT_ADDRESS`, and launch
   with the 50 Pi cap. `NEXT_PUBLIC_PI_SANDBOX` stays false.

See [`docs/`](./docs) for the Pi compliance mapping, the contract specification,
and the CT submission package.

---

## Public API (v1)

Base: `/api`. Auth: partner bearer key (hashed at rest); the reference app uses a
first-party key. See [`docs/API.md`](./docs/API.md).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/trades` | Create a trade → returns id + checkout URL |
| GET | `/api/trades/:id` | State, deadlines, amounts, event history |
| GET | `/api/trades?ref=` | Lookup by partner reference |
| GET | `/api/health` | Status & configuration posture |

State-changing calls (`/fund`, `/ship`, `/confirm`, `/dispute`, `/propose`,
`/accept`, `/cancel`, `/timeout`) mirror the contract functions in PRD §8.3.
`/timeout` is **permissionless** — anyone may trigger a due deadline transition.

---

## Project layout

```
app/                 Next.js routes (UI screens + /api)
  page.tsx           Home (sign-in / dashboard)
  create/            Create a safe trade
  t/[id]/            Checkout — the shareable link target
  trade/[id]/        Trade detail (timeline, actions, payouts, event log)
  dispute/[id]/      Dispute room (settlement slider, nuclear warning)
  profile/           Reputation
  notifications/     Activity center
  api/               Public API + Pi payment + auth + cron
components/           UI library (flat design system)
lib/
  escrow.ts          State machine, parameters, money math (PRD §8)
  store.ts           Engine + transitions (the chain-indexer seam)
  db/                Repository: repo.ts (interface) + firestore-repo.ts + memory-repo.ts
  firebase.ts        firebase-admin (Firestore) init
  webhooks.ts        Partner webhook signing + retry (PRD §9)
  partners.ts        Partner API keys
  chain.ts           Cutover seam to the on-chain contract (lib/store ↔ Soroban)
  pi-client.ts       Pi SDK wrapper (auth, payments, share)
  pi-server.ts       Pi Platform API (token verify, approve/complete payments)
  session.ts         Signed-cookie sessions
contract/            Soroban escrow contract (Rust → WASM) + tests (PRD §8)
scripts/lifecycle.sh End-to-end verification
docs/                Compliance, contract spec, API, CT submission
```

# Security Audit Report

**Project:** Clasp — non-custodial escrow for Pi commerce
**Date:** 2026-06-22
**Auditor:** Claude Security Auditor
**Stack:** Next.js 14 (App Router) · TypeScript · Firebase Firestore · Pi SDK · Soroban (Rust)
**Risk Level (post-fix):** LOW — all CRITICAL/HIGH findings fixed; residuals are tracked recommendations.

## Executive summary

The codebase was already well-structured (server-only secrets, signed sessions, parameterized
queries, per-transition authorization). The audit found and **fixed** one CRITICAL issue — the
reason mobile Pi Browser couldn't log in — plus two HIGH auth/config issues, three MEDIUM hardening
gaps, and patched dependency CVEs. All 24 end-to-end tests pass after the fixes (Firestore backend).

## Threat profile

Clasp moves value: buyers lock Pi into escrow, the contract releases on delivery. Highest-value
targets: (1) forging a session to impersonate a party and trigger payouts, (2) leaking dispute
evidence/PII, (3) minting partner keys to spam/abuse the API, (4) draining funds — mitigated at the
contract layer (funds move only via on-chain, user-signed calls; the backend never holds keys).
Pi embeds the app in a **third-party iframe** on `pinet.com`, which dominates the cookie threat model.

## Findings

### CRITICAL
| # | Finding | Location | OWASP | Status |
|---|---------|----------|-------|--------|
| C1 | Session cookie dropped in mobile Pi Browser (3rd-party iframe) → login fails | `lib/session.ts` | A05 | ✅ FIXED |

#### C1: Third-party cookie blocked on mobile (the login bug)
**Impact:** Pi serves Clasp via `<iframe src="clasp-lyart.vercel.app">` under top-level `pinet.com`,
making the session cookie third-party. Mobile Pi Browser blocks third-party cookies by default, so
after a successful Pi sign-in the cookie was never stored/sent — `/api/me` saw no session and the app
appeared to "connect then stop." Desktop worked only because its webview allows third-party cookies.
**Fix Applied:** Added the **`Partitioned`** attribute (CHIPS) alongside `SameSite=None; Secure`, so
the cookie is retained within the Pi top-level partition even when third-party cookies are blocked.
Added `credentials: 'include'` to client fetches. Verified: `Set-Cookie: …; Secure; HttpOnly;
SameSite=none; Partitioned`.

### HIGH
| # | Finding | Location | OWASP | Status |
|---|---------|----------|-------|--------|
| H1 | Session signing key falls back to a hardcoded default | `lib/session.ts` | A02/A07 | ✅ FIXED |
| H2 | Partner API-key issuance open when `ADMIN_SECRET` unset | `app/api/v1/partners/route.ts` | A01/A05 | ✅ FIXED |
| H3 | Next.js below latest patch (DoS/SSRF/cache-poisoning advisories) | `package.json` | A06 | ✅ PATCHED (residual → recommendation) |

#### H1: Predictable session secret
**Impact:** `SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me'`. Deployed without
the env, anyone knowing the default could forge a signed cookie for any `uid` → full impersonation.
**Fix Applied:** In production the default is removed; signing throws if `SESSION_SECRET` is absent
(fail-closed — no forgeable sessions). `SESSION_SECRET` is set in Vercel.

#### H2: Open partner key minting
**Impact:** `POST /api/v1/partners` skipped the admin check when `ADMIN_SECRET` was unset (the live
default), letting anyone mint partner keys and spam trades via the partner API.
**Fix Applied:** Always require a configured `ADMIN_SECRET` + matching bearer; an unset secret now
**denies** (403) rather than allowing open issuance. Verified by a new test (`401` without admin).

#### H3: Next.js advisories
**Impact:** `next@14.2.15` is affected by several advisories (Server Actions DoS, middleware SSRF,
image-optimizer/cache poisoning).
**Fix Applied:** Upgraded to `next@14.2.35` (latest 14.2.x), which backports the originally-critical
fixes. **Residual:** a handful of advisories are only fully resolved in `next@16` (a breaking major
migration) and target features Clasp does **not** use (`next/image` optimizer, middleware, i18n /
Pages Router, CSP nonces, `beforeInteractive` scripts). Tracked as a recommendation rather than a
risky mid-launch major upgrade.

### MEDIUM
| # | Finding | Location | OWASP | Status |
|---|---------|----------|-------|--------|
| M1 | 500 responses leaked internal error messages | `lib/api.ts` | A09/A05 | ✅ FIXED |
| M2 | Dispute evidence returned to any link-holder | `app/api/trades/[id]/route.ts` | A01 | ✅ FIXED |
| M3 | Missing HSTS / anti-clickjacking / Permissions-Policy headers | `next.config.js` | A05 | ✅ FIXED |
| M4 | No rate limiting on auth/trade/partner endpoints | API routes | A04/A07 | ⚠ REQUIRES MANUAL ACTION |

#### M1: Internal error leakage
Unhandled errors returned `e.message` (could expose DB/stack detail). Now logged server-side and
returned as a generic message.

#### M2: Evidence over-exposure
The trade id is an unguessable capability (the checkout link), so terms are intentionally viewable by
link-holders — but dispute **evidence** (photos, possible PII) was included for anyone with the link.
Now returned only to the authenticated buyer/seller.

#### M3: Security headers
Added `Strict-Transport-Security`, `Content-Security-Policy: frame-ancestors 'self' https://*.pinet.com
https://*.minepi.com` (only Pi may embed Clasp — anti-clickjacking), and `Permissions-Policy`.

#### M4: Rate limiting (manual)
No per-IP/per-key throttling on `/api/auth`, trade creation, or the partner API → brute-force/DoS
surface. On serverless this needs a shared store. **Recommendation:** add Upstash Redis (or a Firestore
counter) limiter — e.g. 10 auth attempts/min/IP, 60 trades/hour/key.

### LOW
- `Math.random()` generates the local-preview sandbox token in `app/providers.tsx`. Not
  security-sensitive (never used in Pi Browser / production identity), but noted.

## Verified secure (no change required)
- **Pi token validation** — every sign-in calls `GET /v2/me` with the user's `Bearer` token before a
  session is issued; no API key required (`lib/pi-server.ts`).
- **Secrets** — all server-only (`server-only` imports); no secret in the client bundle; only
  `NEXT_PUBLIC_*` (sandbox flag, contract address) ship to the browser; `.env` git-ignored; no secret
  in git history; `.env.example` is placeholder-only.
- **Firestore** — default-deny rules (`firestore.rules`); clients never touch the DB; the admin SDK is
  server-only. Queries are single-field/parameterized — no injection.
- **Crypto** — HMAC-SHA256 with `timingSafeEqual` for sessions and webhook signatures; `randomUUID` /
  `randomBytes` (CSPRNG) for ids and API keys; partner keys stored only as SHA-256 hashes.
- **Authorization** — every state transition enforces the correct actor (buyer/seller/counterparty),
  covered by tests; permissionless timeouts are by design.
- **Input validation** — `zod` schemas at all API boundaries; evidence images restricted to
  `data:image/(png|jpe?g|webp|gif)` and size-capped; no `dangerouslySetInnerHTML`; React escapes text.
- **CORS** — none of the app endpoints set permissive CORS; partner API is bearer-authenticated.

## Dependency audit summary
| Package | From | To | Action |
|---|---|---|---|
| next | 14.2.15 | 14.2.35 | Upgraded — patched DoS/SSRF/cache-poisoning advisories |
| firebase-admin | 12.7.0 | 13.10.0 | Upgraded — cleared transitive moderates (google-gax, uuid, retry-request, teeny-request) |
| next (residual) | 14.2.35 | 16.x | Recommendation — breaking major; residual advisories target unused features |
| glob (dev, transitive) | — | — | High CLI advisory, not invoked by us; resolved only by a breaking dev-dep bump — not applicable |

## Security headers check
| Header | Status | Value |
|---|---|---|
| Strict-Transport-Security | ✅ | `max-age=63072000; includeSubDomains; preload` |
| Content-Security-Policy | ✅ | `frame-ancestors 'self' https://*.pinet.com https://*.minepi.com` |
| X-Content-Type-Options | ✅ | `nosniff` |
| Referrer-Policy | ✅ | `strict-origin-when-cross-origin` |
| Permissions-Policy | ✅ | `geolocation=(), microphone=(), payment=()` |
| Set-Cookie | ✅ | `Secure; HttpOnly; SameSite=none; Partitioned` |

## Recommendations (prioritized)
1. **Rate limiting** (M4) — add Upstash/Firestore-based throttling before mainnet.
2. **Next.js 15/16 migration** (H3 residual) — schedule as its own task (async `cookies()`/`params`).
3. **Independent Soroban contract audit** — the on-chain contract (`contract/`) must get the external
   third-party audit mandated by PRD §8.4.8 before mainnet; this review covered the app, not a formal
   contract audit.
4. Set `ADMIN_SECRET` in Vercel if you intend to issue partner keys (else issuance stays disabled).

## What was NOT checked
- Runtime behavior under load / DoS resilience (static review only).
- Formal verification or economic-exploit analysis of the Soroban contract (separate audit per §12).
- Pi Platform-side configuration and the `pinet.com` proxy/iframe internals (out of our control).
- Infrastructure/network policies on Vercel and Firebase beyond app-level config.

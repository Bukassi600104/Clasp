# Escrow Contract Specification (PRD §8)

The on-chain contract is the single source of financial truth. It is written in
Rust → WASM (Soroban, per Pi v23.0) and deployed to Pi mainnet with **no admin
keys**. The reference app mirrors its rules in `lib/escrow.ts` so amounts and
state shown in the UI are computed identically; at runtime the chain is
authoritative and the backend only reflects confirmed events.

> Build status: the contract is delivered across PRD Sessions 1–3. This document
> is the authoritative spec the implementation and the app's mirror both follow.

## State machine

```
CREATED ──(buyer funds: price + buyer bond; seller bond already locked)──▶ FUNDED
CREATED ──(seller cancels, or funding deadline passes)──────────────────▶ CANCELLED

FUNDED  ──(seller mark_shipped within ship window, evidence_hash)───────▶ SHIPPED
FUNDED  ──(ship window expires, anyone calls timeout)───────────────────▶ REFUNDED

SHIPPED ──(buyer confirm_receipt)───────────────────────────────────────▶ COMPLETED
SHIPPED ──(inspection window expires silently; anyone calls timeout)────▶ COMPLETED
SHIPPED ──(buyer open_dispute within inspection window)─────────────────▶ DISPUTED

DISPUTED──(either proposes split, counterparty accepts)─────────────────▶ SETTLED
DISPUTED──(settlement window expires, anyone calls timeout)─────────────▶ NUCLEAR
```

## Parameters (`PARAMS` in `lib/escrow.ts`)

| Parameter | Value |
|---|---|
| Trade amount | 1 – 50 Pi (launch cap) |
| Buyer / seller bond | 15% of price, floor 1 Pi each |
| Funding window | 24h fixed |
| Ship window | 24h – 14d (default 72h) |
| Inspection window | 24h – 7d (default 72h) |
| Settlement window | 7d fixed |
| Settlement steps | 5% increments |
| Fee | 1.5%, min 0.05 Pi, seller-side, on release only |

## Payout math (verified by `scripts/lifecycle.sh`)

- **COMPLETED:** seller gets `price − fee + sellerBond`; buyer gets `buyerBond`;
  operator gets `fee`.
- **REFUNDED:** buyer gets `price + buyerBond`; seller gets `sellerBond`.
- **SETTLED:** principal split per accepted `sellerPct`; fee taken only on the
  seller's portion; both bonds returned; dust → buyer.
- **NUCLEAR:** both bonds burned; principal split 50/50; dust → buyer.

## Contract functions (PRD §8.3)

`create_trade`, `fund_trade`, `cancel_unfunded`, `mark_shipped`,
`confirm_receipt`, `open_dispute`, `propose_settlement`, `accept_settlement`,
`claim_timeout` (permissionless), plus read functions `get_trade` / `get_state`.
All transitions emit events `(trade_id, old_state, new_state, amounts, ts)`.

## Security requirements (non-negotiable — PRD §8.4)

1. **No admin functions** — no upgrade key, no pause key, no operator withdrawal
   beyond the automatic fee split. Nothing to rug.
2. **Checks-effects-interactions** on every transition; state finalized before
   any transfer.
3. **Ledger time only** for deadlines — no client timestamps, no oracle.
4. **Permissionless timeouts** — `claim_timeout` callable by anyone, so no party
   can stall and a backend outage cannot strand funds.
5. **Strict per-function authorization** (only buyer confirms/disputes, only
   seller ships, only counterparty accepts).
6. **Integer micro-Pi math**; dust remainder → buyer.
7. **Exhaustive state guards**; every function rejects calls in the wrong state;
   no transition reachable twice.
8. **Audit chain:** self-audit (security-auditor skill, OWASP-mapped) → independent
   third-party audit before mainnet → report published.
9. **Testnet soak** per §12 gates before mainnet.
10. **Burn address** is provably unspendable and documented publicly.

## Reference engine ↔ contract seam

`lib/store.ts` implements the same transitions and guards in-process. To go live
against the real contract, replace the bodies of the transition functions with
signed contract calls and replace `advanceTimeouts` with a chain indexer that
polls confirmed events via Pi RPC — the API routes and UI are unchanged.

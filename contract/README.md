# Clasp Escrow Contract (Soroban)

The non-custodial escrow contract for Pi commerce. Rust → WASM via Soroban, the
smart-contract platform on Pi mainnet (v23.0). Implements the PRD §8 state
machine and money math exactly; the reference app's `lib/escrow.ts` mirrors it.

## Security posture (PRD §8.4)

- **No admin functions.** `initialize` sets the fee/burn/token addresses once;
  after that there is **no** upgrade key, pause key, or operator withdrawal
  beyond the automatic fee split. There is nothing to rug.
- **Checks-effects-interactions:** state is finalized and written *before* any
  token transfer in every payout path.
- **Ledger time only** for deadlines (`env.ledger().timestamp()`).
- **Permissionless timeouts:** `claim_timeout` is callable by anyone, so no party
  can stall and a backend outage cannot strand funds.
- **Strict per-function authorization** (only buyer confirms/disputes, only
  seller marks shipped, only the counterparty accepts a proposal).
- **Integer math** in stroops (1 Pi = 10,000,000); dust remainder always to buyer.
- **Forfeited bonds burned** to a provably unspendable address — never collected.

## Build & test

```bash
cd contract
cargo test                                   # unit tests (offline, no network)
cargo build --release --target wasm32-unknown-unknown   # the deployable .wasm
```

Optimize the wasm before deploy:
```bash
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/clasp_escrow.wasm
```

## Deploy to Pi testnet (PRD Session 1 — the go/no-go spike)

```bash
# 1. Identity + funding
stellar keys generate operator --network testnet
# 2. Deploy
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/clasp_escrow.wasm \
  --source operator --network testnet
# → prints CONTRACT_ID
# 3. Initialize (fee wallet, burn address, Pi token SAC address)
stellar contract invoke --id <CONTRACT_ID> --source operator --network testnet \
  -- initialize --fee_account <FEE_ADDR> --burn_account <BURN_ADDR> --token <PI_TOKEN_SAC>
```

Set `NEXT_PUBLIC_CONTRACT_ADDRESS=<CONTRACT_ID>` in the app so it's shown
everywhere (anti-phishing, §16). The app's `lib/chain.ts` wraps these calls.

## Burn address

Use a provably unspendable account (e.g. an all-zero / muxed sink with no signer)
and document it publicly per §8.4.10 and the CT submission (§17.4).

## Function surface

| Fn | Caller | Transition |
|---|---|---|
| `create_trade(seller, amount, ship_window, inspect_window, memo_hash)` | seller | → CREATED (locks seller bond), returns id |
| `fund_trade(buyer, id)` | buyer | CREATED → FUNDED (locks price + buyer bond) |
| `cancel_unfunded(caller, id)` | seller / anyone after window | CREATED → CANCELLED |
| `mark_shipped(id, evidence_hash)` | seller | FUNDED → SHIPPED |
| `confirm_receipt(id)` | buyer | SHIPPED → COMPLETED |
| `open_dispute(id)` | buyer | SHIPPED → DISPUTED |
| `propose_settlement(caller, id, seller_pct)` | party | DISPUTED (5% steps) |
| `accept_settlement(caller, id)` | counterparty | DISPUTED → SETTLED |
| `claim_timeout(id)` | **anyone** | REFUNDED / COMPLETED / NUCLEAR / expiry-cancel |
| `get_trade(id)` · `get_state(id)` · `get_config()` | read | — |

> Audit chain (§8.4.8): self-audit with the security-auditor skill, then an
> independent third-party audit before mainnet, report published.

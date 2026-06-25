# Clasp — Pi Testnet deploy runbook (validated)

Every command below was validated end-to-end on Stellar testnet (Protocol 23):
deploy → `initialize` → `create_trade` → `fund_trade` → `mark_shipped` →
`confirm_receipt` produced the exact payouts (price − 1.5% fee + bond to seller,
bonds returned, fee to fee_account) with **zero funds left in the contract**.
Only the funded-deployer step is environment-specific.

## Network (confirmed live)

- RPC: `https://rpc.testnet.minepi.com` (Protocol 26, Soroban enabled)
- Network passphrase: **`Pi Testnet`** (Pi-specific — not Stellar's default)
- Pi native token SAC: `CDG6ZM2SHXIHD5HZ2E62B7D76RY5DUHDNQVPSHRVDNN7W4EW47FXLEXQ`

```bash
stellar network add pi-testnet \
  --rpc-url https://rpc.testnet.minepi.com \
  --network-passphrase "Pi Testnet"
```

## Critical build step (reference-types fix)

Rust ≥ 1.82 emits WASM with `reference-types`, which Soroban's VM rejects
(`reference-types not enabled`). `RUSTFLAGS` does **not** fix it. The fix is to
optimize the wasm (runs `wasm-opt`):

```bash
cd contract
cargo build --release --target wasm32-unknown-unknown
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/clasp_escrow.wasm
# → clasp_escrow.optimized.wasm   (this is the deployable artifact; also vendored at contract/deploy/)
```

## Fund the deployer (the only step needing test Pi)

Deployer account (key in `~/.config/stellar/identity/clasp-deployer.toml`):

```
GDTL5IIVB4V7IUVPGTBRIJDIEXPTLC7MYPDWVIWY4QSCS7VVLJWGPZ64
```

Send ~10 test π to it from the Pi Wallet (Pi has no public friendbot; the faucet
only tops up your own wallet). Burn address (secret discarded → unspendable):
`GB75KZP737V6NRCJJ6SP2FPWNHSVACFMVD6PLU66VHAAL4SKKIPVHS32`.

## Deploy + initialize

```bash
WASM=contract/deploy/clasp_escrow.optimized.wasm
HASH=$(stellar contract upload --wasm $WASM --source clasp-deployer --network pi-testnet)
CID=$(stellar contract deploy --wasm-hash $HASH --source clasp-deployer --network pi-testnet)

stellar contract invoke --id $CID --source clasp-deployer --network pi-testnet --send=yes -- \
  initialize \
  --fee_account <APP_WALLET_G_ADDRESS> \
  --burn_account GB75KZP737V6NRCJJ6SP2FPWNHSVACFMVD6PLU66VHAAL4SKKIPVHS32 \
  --token CDG6ZM2SHXIHD5HZ2E62B7D76RY5DUHDNQVPSHRVDNN7W4EW47FXLEXQ

stellar contract invoke --id $CID --source clasp-deployer --network pi-testnet -- get_config
```

## Wire the app to the contract

```bash
vercel env add NEXT_PUBLIC_CONTRACT_ADDRESS production   # <CID>
vercel env add PI_RPC_URL production                     # https://rpc.testnet.minepi.com
vercel env add PI_TOKEN_SAC production                   # CDG6ZM2S…LEXQ
vercel deploy --prod --yes
```

> ⚠️ **This does not make the app non-custodial yet.** Setting
> `NEXT_PUBLIC_CONTRACT_ADDRESS` only flips `contractConfigured()` and lets the
> backend *read* contract state. The *write* path (buyers/sellers signing escrow
> calls) requires the Pi Wallet to sign a Soroban `InvokeHostFunction` — and the
> public Pi JS SDK has **no method for that** (only `createPayment`, which signs a
> payment). Until Pi ships wallet-signed contract invocation, the live app stays
> on the custodial Pi-SDK payment bridge. Deploying the contract here proves the
> bytecode runs on Pi; it does not wire user funds through it.

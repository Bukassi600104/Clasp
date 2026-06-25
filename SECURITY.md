# Security Policy

Clasp is non-custodial escrow infrastructure for Pi commerce. Security is the
product, so we take reports seriously.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities. Instead,
email **bukassi@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- any suggested remediation.

We aim to acknowledge reports within 72 hours.

## Scope

- The reference web app (`app/`, `lib/`) and public API.
- The Soroban escrow contract (`contract/`).

## Current status (read this first)

The on-chain, non-custodial design below is the **target architecture**, not the
state of the deployed reference app. As of this writing:

- The escrow contract (`contract/`) is written, unit-tested, and its full
  lifecycle has been validated on **Stellar** testnet — but it is **not deployed
  on Pi**, and the live app does **not** route funds through it.
- The deployed app uses the **Pi SDK payment bridge** (`Pi.createPayment`), which
  is a **custodial** flow: the buyer's Pi is paid **to the app's Pi account**, not
  into a contract.
- **Platform limitation:** the Pi JavaScript SDK exposes only
  `authenticate` / `createPayment` / share / ads — there is **no documented method
  for a Pi Browser app to have the user's wallet sign a Soroban contract
  invocation**. Until Pi ships that capability, the non-custodial design here
  cannot be exercised by end users from Pi Browser.

Do not rely on the guarantees below for the currently deployed app.

## Design guarantees (target on-chain architecture)

- **Non-custodial:** funds only ever sit inside the on-chain contract; no operator
  wallet ever holds user funds.
- **No admin keys** on the contract: no upgrade, pause, or withdrawal beyond the
  automatic fee split.
- **Server never sees keys:** all signing happens in Pi Wallet; the backend only
  verifies Pi access tokens server-side.

The contract carries inherent smart-contract risk and trade amounts are capped at
launch to bound exposure. An independent audit precedes any cap increase.

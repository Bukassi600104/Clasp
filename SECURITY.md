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

## Design guarantees

- **Non-custodial:** funds only ever sit inside the on-chain contract; no operator
  wallet ever holds user funds.
- **No admin keys** on the contract: no upgrade, pause, or withdrawal beyond the
  automatic fee split.
- **Server never sees keys:** all signing happens in Pi Wallet; the backend only
  verifies Pi access tokens server-side.

The contract carries inherent smart-contract risk and trade amounts are capped at
launch to bound exposure. An independent audit precedes any cap increase.

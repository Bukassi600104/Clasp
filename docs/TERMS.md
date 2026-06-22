# Terms of Service — Clasp Escrow

_Last updated: launch._

## What Clasp is
Clasp is non-custodial escrow infrastructure for the Pi Network. It provides a
smart contract that locks Pi until delivery is confirmed, plus an app and API to
use it. **Clasp is not a marketplace, a bank, or a custodian.**

## What Clasp does not do
- It never holds your funds. Pi only ever sits inside the on-chain contract.
- It never decides disputes. Outcomes are determined by you, your counterparty,
  and the contract's deadline rules.
- It never reverses, freezes, or claws back a transaction.

## Bonds
Both parties post a refundable performance bond (15% of price, floor 1 Pi). Bonds
are returned on any honest outcome. In the nuclear outcome (no settlement reached
in time), both bonds are burned to a provably unspendable address — never
collected by the operator.

## Fees
A 1.5% fee (minimum 0.05 Pi) is charged by the contract on the amount released to
the seller, only when a trade completes or settles. No fees on disputes, refunds,
or cancellations.

## Your responsibilities
- Verify the official contract address (shown in-app under "How your money stays
  safe"). Clasp never requests payment via direct message.
- Ship and confirm within the agreed windows. Missing a deadline triggers an
  automatic, permissionless on-chain outcome that nobody can override.

## No warranty
The service is provided "as is". Smart contracts carry inherent risk; trade
amounts are capped at launch to bound exposure. Use at your own discretion.

## Acceptable use
Pi only. No gambling, no illegal goods, no activity prohibited by Pi's developer
guidelines.

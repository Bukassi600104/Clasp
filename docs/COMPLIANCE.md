# Pi Ecosystem Compliance Mapping

Maps Clasp Escrow to Pi's developer requirements (PRD §4). This document is
part of the CT submission package (§17).

| Pi requirement | How Clasp complies | Where in code |
|---|---|---|
| Pi Authentication only, no email/password | Pi SDK auth is the only login method | `lib/pi-client.ts`, `app/api/auth/route.ts` |
| Pi and Pi-based tokens only | Contract and app handle Pi exclusively; amounts shown in `π` | `lib/escrow.ts`, `lib/format.ts` |
| No gambling, betting, lottery | Outcomes are determined entirely by participant actions — never chance. No randomness, no house, no wager. Bonds are **performance bonds** (the centuries-old construction-contract mechanism) | `lib/escrow.ts` state machine |
| No representations about Pi's value | No fiat conversions, no price commentary anywhere in the UI | all UI copy |
| Never request/store/display passphrases or private keys | All signing happens in Pi Wallet; the app only handles access tokens + payment ids | `lib/pi-client.ts` |
| Server-side payment verification | Pi Platform API calls (`/me`, approve, complete) happen server-side; the secret key never ships to the client | `lib/pi-server.ts` |
| Seamless experience within Pi | The entire flow lives inside Pi Browser; no funnel to external platforms | `app/layout.tsx` |
| Developer mainnet wallet KYC | Operator is KYC-verified (complete) | operational |
| KYB | Not required at launch (individual developer, per Pi's KYB guidance). Roadmap item after incorporation | PRD §14 |

## Non-custodial guarantee

Funds only ever sit inside the smart contract. No operator-controlled wallet
holds user funds. The operator's fee wallet receives the 1.5% fee **only**, paid
automatically by the contract on successful completion. If the backend
disappears, every locked trade still resolves correctly on-chain via
permissionless timeouts.

## Not-gambling rationale

- The buyer and seller fully determine the outcome through their own actions
  (ship / confirm / dispute / settle).
- There is no element of chance, no randomness, and no house position.
- The bonds are **performance bonds**: collateral that is returned on honest
  performance and only at risk on default — identical in principle to a
  construction performance bond.
- Forfeited bonds in the nuclear outcome are **burned** to a provably unspendable
  address, never collected by the operator. The operator therefore never profits
  from failure (PRD §2.6, §8.1).

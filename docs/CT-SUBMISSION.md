# CT Submission Package (PRD §17)

Prepared as a single document for Pi's Core Team review of financial contracts.

1. **Architecture statement.** Non-custodial by design. Funds only ever sit in
   the smart contract; the operator's wallet receives the 1.5% fee only, paid
   automatically by the contract. Contract address: `<NEXT_PUBLIC_CONTRACT_ADDRESS>`
   (published in-app and in every share message). **No admin functions** — no
   upgrade key, no pause key, no operator withdrawal beyond the fee split.

2. **Open-source contract repository.** `<link>` — Rust/Soroban source, build
   instructions, and the full test suite (happy path, timeouts, dispute,
   settlement, nuclear, fuzzing).

3. **Independent audit report.** `<link>` — all critical/high findings resolved;
   report published before mainnet.

4. **Forfeited-funds policy.** Bonds forfeited in the nuclear outcome are
   **burned** to a provably unspendable, publicly documented address. They are
   never collected by the operator. Revenue comes exclusively from successful
   trades.

5. **Not-gambling rationale.** Outcomes are determined entirely by participant
   actions — never chance. No randomness, no house, no wager. Bonds are
   performance bonds (construction-contract precedent). See `docs/COMPLIANCE.md`.

6. **Pi guidelines compliance mapping.** See `docs/COMPLIANCE.md` (PRD §4 table).

7. **Privacy policy & terms of service.** Minimal data collected: Pi uid,
   username, trade metadata, and dispute evidence images. No private keys, no
   passphrases, no fiat data. See `docs/PRIVACY.md` and `docs/TERMS.md`.

8. **KYC / KYB status.** Developer is KYC-verified (Pi mainnet wallet). KYB is a
   roadmap milestone after incorporation (CAC, Nigeria) to gain the verified
   business listing and a business mainnet wallet.

## Testnet validation gates (must pass ALL before mainnet — PRD §12)

| Gate | Threshold | Tooling |
|---|---|---|
| Completed test trades | 200+ across 30+ distinct testnet users | `scripts/lifecycle.sh` + manual |
| Funds stuck past deadlines | 0, ever | indexer monitoring |
| Permissionless timeouts | every deadline type executed by a third party ≥10× | `/api/trades/:id/timeout` |
| Dispute simulations | 30+ scripted; 90%+ reach SETTLED, NUCLEAR <10% | settlement harness |
| Adversarial testing | scam-buyer / scam-seller bots, 50+ attempts each; expected-loss confirmed | bot scripts |
| Contract fuzzing | no invalid transition reachable | Soroban fuzz tests |
| Independent audit | report delivered, criticals/highs fixed, published | external auditor |
| Bond/window tuning | parameters revisited against testnet data before freeze | analysis |

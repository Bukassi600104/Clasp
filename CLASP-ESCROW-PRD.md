# Clasp — Escrow Flow & Money Model (Source of Truth)

> This document is the **authoritative specification** for how a Clasp trade
> works end to end: the money model, the payment steps, settlement payouts,
> notifications, and ratings. When code and this document disagree, treat this as
> the intended behaviour and fix the code (or update this doc deliberately).
>
> Custody note: Clasp is **custodial**. Buyer/seller funds are held in the Pi
> **App Wallet** (`GCUG…`, also the revenue wallet) between funding and
> settlement, and released by the app via App-to-User (A2U) payments. Clasp never
> sees a user's wallet keys, and never decides a dispute outcome.

---

## 1. Two separate amounts: Bond vs Platform Fee

These are **independent** and must never be conflated.

| | Security **Bond** | Platform **Fee** (commission) |
|---|---|---|
| What | Good-faith deposit that keeps both sides honest | Clasp's revenue for facilitating the trade |
| Who pays | **BOTH** the seller and the buyer | **One** party — chosen at creation |
| Amount | 15% of price (floor 1 π) | 1.5% of price (floor 0.05 π) |
| When charged | Posted up front, **returned in full** on every honest outcome | Taken **only** when a trade completes or settles |
| Where it goes on success | Back to whoever posted it | Kept by Clasp (operator) |

**Platform fee payer is selectable.** On the create screen the seller chooses
**“Buyer pays”** (fee added on top of the price) or **“I’ll pay it”** (fee taken
from the seller’s proceeds). The buyer↔seller agreement on who absorbs it is not
Clasp’s concern; Clasp only records and enforces the selection.

### Worked example — 60 π item (bond = 9 π, fee = 0.9 π)

| | Seller pays fee | Buyer pays fee |
|---|---|---|
| Seller posts at create | 9 π bond | 9 π bond |
| Buyer locks at funding | 60 + 9 = **69 π** | 60 + 9 + 0.9 = **69.9 π** |
| On completion → seller receives | 60 − 0.9 + 9 = **68.1 π** | 60 + 9 = **69 π** |
| Buyer receives back | 9 π bond | 9 π bond |
| Clasp keeps | 0.9 π | 0.9 π |

All amounts are integer micro-Pi (1 π = 1,000,000 µπ); dust always rounds to the
buyer. Canonical math lives in `lib/escrow.ts` (`bondFor`, `feeFor`,
`sellerLockTotal`, `buyerLockTotal`, `completedPayout`, `refundedPayout`,
`settledPayout`, `nuclearPayout`).

---

## 2. Trade lifecycle & payment steps

**Both bonds are real, collected via Pi payments into the App Wallet.**

1. **Create (seller).** Seller sets price, windows, memo, and the **fee payer**.
   On submit the seller **pays their security bond** via Pi (U2A, `kind:
   seller_bond`). The trade is created in `CREATED` but is **not live** —
   `seller_bond_paid=false` — until that bond payment completes.
   - The share link and “ready” state appear **only after** the bond is posted.
   - If the bond payment is cancelled/fails, the trade stays inactive and the
     seller is shown a **“Post your security bond”** action to retry. A buyer
     cannot fund an unbonded trade (`fundTrade` rejects it).
2. **Fund (buyer).** Buyer opens the link and pays **price + buyer bond (+ fee if
   buyer pays)** via Pi (U2A, `kind: escrow_lock`). Trade → `FUNDED`. Both
   parties are notified.
3. **Ship (seller).** Seller marks shipped with proof. Trade → `SHIPPED`. **Buyer
   is notified to track/inspect.**
4. **Resolve.** One of:
   - Buyer **confirms receipt** → `COMPLETED`.
   - Inspection window passes in silence → auto `COMPLETED`.
   - Buyer **opens a dispute** → `DISPUTED` → parties propose/accept a split →
     `SETTLED`; if no settlement in time → `NUCLEAR`.
   - Seller misses the ship window → buyer auto-refunded → `REFUNDED`.
5. **Payout (custodial, A2U).** On any funded-terminal state the app **enqueues
   payouts** and sends Pi from the App Wallet back to the parties per the math
   below (`lib/payouts.ts` + `lib/pi-payout.ts`, gated on
   `PI_WALLET_PRIVATE_SEED`). Each payout is idempotent per (trade, role) and
   resumable (create→submit→complete) so a retry never double-pays.

### Settlement payouts

| Outcome | Seller receives | Buyer receives | Clasp keeps | Bonds |
|---|---|---|---|---|
| COMPLETED | price (− fee if seller pays) + seller bond | buyer bond | fee | both returned |
| REFUNDED | seller bond | price + buyer bond + any prepaid fee | 0 | both returned |
| SETTLED (sellerPct) | sellerPct·price (− fee) + bond | rest + bond + fee refund | fee on seller’s share | both returned |
| NUCLEAR | price/2 | price/2 + any prepaid fee | 0 | both forfeited |

---

## 3. State machine

`CREATED → FUNDED → SHIPPED → (COMPLETED | DISPUTED)`,
`DISPUTED → (SETTLED | NUCLEAR)`, plus `CREATED → CANCELLED` (unfunded) and
`FUNDED → REFUNDED` (seller no-show). Terminal: `COMPLETED, SETTLED, REFUNDED,
CANCELLED, NUCLEAR`. A `CANCELLED`/expired **unfunded** trade can be
**reactivated** by the seller (fresh 24h window) instead of recreated. All
deadline transitions are time-based and applied on read (`advanceTimeouts`).

---

## 4. Notifications (per trade)

Every state change writes a notification **bound to that trade** (`trade_id`) and
delivered to the **correct party**, surfaced on the Activity screen and linking to
the trade:

| Event | Seller notified | Buyer notified |
|---|---|---|
| Funded | ✅ “ship now” | ✅ “payment locked” |
| **Shipped** | — | ✅ **“seller marked shipped — track/inspect”** |
| Completed | ✅ “you got paid” | ✅ “bond returned” |
| Disputed / Settled / Refunded / Nuclear | ✅ | ✅ |

---

## 5. Ratings

- **Optional** for both parties — never required to finish a trade.
- Appears **only when the trade has reached a funded terminal outcome** (it’s
  complete) and only to a party of that trade.
- **Specific to that trade**: each party may rate the other **once per trade**;
  the rating aggregates onto the counterparty’s profile by the role they played.

---

## 6. Configuration (Pi Developer Portal ↔ Vercel)

For payments to work, ALL of these must belong to the **one** Clasp Testnet app:
- Hosting/verified URL = `https://claspescrow.com`
- `PI_VALIDATION_KEY` = that app’s validation key (served at `/validation-key.txt`)
- `PI_API_KEY` = that app’s server API key
- `PI_WALLET_PRIVATE_SEED` = the seed of the app’s connected App Wallet (`GCUG…`),
  the same wallet that receives U2A funds and signs A2U payouts.

A mismatch in any of these surfaces as `getPayment 404` at approval (“the
developer has failed to approve this payment”).

/**
 * Money-math unit tests (AUDIT.md F6). Runs on Node's built-in test runner with
 * native TypeScript type stripping — no test framework dependency:
 *
 *   npm run test:unit      (node --test tests/money.test.ts)
 *
 * The core property is SOLVENCY: for every outcome and fee-payer choice, what
 * the escrow pays out (both parties + operator fee + burned bonds) must equal
 * exactly what it collected up front (seller deposit + buyer deposit). A single
 * micro-Pi of drift would either strand funds in the wallet or drain it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAMS, piToMicro, microToPi, bondFor, feeFor,
  sellerLockTotal, buyerLockTotal,
  completedPayout, refundedPayout, settledPayout, nuclearPayout,
  validateCreate,
} from '../lib/escrow.ts';

const PI = 1_000_000n; // micro-Pi per Pi

test('piToMicro rounds to the nearest micro-Pi', () => {
  assert.equal(piToMicro(1), 1_000_000n);
  assert.equal(piToMicro(0.05), 50_000n);
  assert.equal(piToMicro(0.0000004), 0n);   // below half a micro rounds down
  assert.equal(piToMicro(0.0000006), 1n);   // above half a micro rounds up
  assert.equal(piToMicro(74.75), 74_750_000n);
});

test('microToPi inverts piToMicro for representable values', () => {
  for (const pi of [1, 2, 3.33, 10, 59.9, 100]) {
    assert.equal(microToPi(piToMicro(pi)), pi);
  }
});

test('bondFor is 10% with a 1 Pi floor', () => {
  assert.equal(bondFor(100n * PI), 10n * PI);        // 10% above the floor
  assert.equal(bondFor(2n * PI), 1n * PI);           // 10% of 2 is 0.2, floor applies
  assert.equal(bondFor(10n * PI), 1n * PI);          // exactly at the floor boundary
  assert.equal(bondFor(10n * PI + 10n), 1_000_001n); // a hair above 10 Pi beats the floor
  assert.equal(bondFor(11n * PI), 1_100_000n);       // 10% just above the floor
  assert.equal(bondFor(0n), 1n * PI);                // 0 amount still floors (creation blocks <1 Pi anyway)
});

test('feeFor is 1.5% with a 0.05 Pi floor and 0 for nothing released', () => {
  assert.equal(feeFor(0n), 0n);
  assert.equal(feeFor(-5n), 0n);
  assert.equal(feeFor(100n * PI), 1_500_000n);       // 1.5 Pi
  assert.equal(feeFor(2n * PI), 50_000n);            // 0.03 < floor, floor applies
  assert.equal(feeFor(3_333_333n), 50_000n);         // 49,999.995 truncates below the floor
  assert.equal(feeFor(3_340_000n), 50_100n);         // just above the floor
});

test('seller deposit = bond, plus commission only when the seller pays it', () => {
  const amount = 100n * PI;
  assert.equal(sellerLockTotal(amount, 'seller'), 10n * PI + 1_500_000n); // 11.5
  assert.equal(sellerLockTotal(amount, 'buyer'), 10n * PI);               // 10
});

test('buyer deposit = price + bond, plus commission only when the buyer pays it', () => {
  const amount = 100n * PI;
  assert.equal(buyerLockTotal(amount, 'seller'), 110n * PI);              // 110
  assert.equal(buyerLockTotal(amount, 'buyer'), 110n * PI + 1_500_000n);  // 111.5
});

test('completed: seller gets the full price plus bond, commission stays with the operator', () => {
  const amount = 100n * PI;
  for (const payer of ['seller', 'buyer'] as const) {
    const p = completedPayout(amount, payer);
    assert.equal(p.sellerReceives, 110n * PI);
    assert.equal(p.buyerReceives, 10n * PI);
    assert.equal(p.operatorFee, 1_500_000n);
    assert.equal(p.burned, 0n);
  }
});

test('refunded: no commission is earned, the prepaid fee returns to whoever paid it', () => {
  const amount = 100n * PI;
  const sellerPays = refundedPayout(amount, 'seller');
  assert.equal(sellerPays.sellerReceives, 10n * PI + 1_500_000n); // bond + fee back
  assert.equal(sellerPays.buyerReceives, 110n * PI);              // price + bond
  const buyerPays = refundedPayout(amount, 'buyer');
  assert.equal(buyerPays.sellerReceives, 10n * PI);
  assert.equal(buyerPays.buyerReceives, 110n * PI + 1_500_000n);
  assert.equal(sellerPays.operatorFee + buyerPays.operatorFee, 0n);
});

test('settled: principal splits per the accepted percentage, dust goes to the buyer', () => {
  const amount = 33n * PI + 333_333n; // odd amount so 5% steps leave dust
  const bond = bondFor(amount);
  for (const pct of [0n, 5n, 40n, 55n, 100n]) {
    const p = settledPayout(amount, pct, 'seller');
    const sellerPrincipal = p.sellerReceives - bond;
    const buyerPrincipal = p.buyerReceives - bond;
    assert.equal(sellerPrincipal + buyerPrincipal, amount);       // nothing lost
    assert.equal(sellerPrincipal, (amount * pct) / 100n);         // floor division
    assert.ok(buyerPrincipal >= (amount * (100n - pct)) / 100n);  // dust lands on the buyer
  }
});

test('nuclear: 50/50 split with dust to the buyer, bonds burned, prepaid fee returned', () => {
  const amount = 7n * PI + 777_777n; // odd → uneven halves
  const p = nuclearPayout(amount, 'buyer');
  const fee = feeFor(amount);
  const sellerHalf = p.sellerReceives;
  const buyerHalf = p.buyerReceives - fee; // buyer prepaid the fee, gets it back
  assert.equal(sellerHalf + buyerHalf, amount);
  assert.ok(buyerHalf >= sellerHalf);            // dust to the buyer
  assert.equal(p.burned, bondFor(amount) * 2n);
  assert.equal(p.operatorFee, 0n);
});

test('SOLVENCY: payouts + kept fee + burned bonds equal exactly what was collected', () => {
  const amounts = [
    1n * PI, 2n * PI, 3_333_333n, 10n * PI, 33_333_333n,
    60n * PI, 100n * PI, 7_777_777n, 999_999n + 1n * PI,
  ];
  for (const amount of amounts) {
    for (const payer of ['seller', 'buyer'] as const) {
      const collected = sellerLockTotal(amount, payer) + buyerLockTotal(amount, payer);
      const outcomes = [
        completedPayout(amount, payer),
        refundedPayout(amount, payer),
        settledPayout(amount, 40n, payer),
        settledPayout(amount, 100n, payer),
        nuclearPayout(amount, payer),
      ];
      for (const o of outcomes) {
        const distributed = o.sellerReceives + o.buyerReceives + o.operatorFee + o.burned;
        assert.equal(
          distributed, collected,
          `insolvent outcome for amount=${amount} payer=${payer}: distributed=${distributed} collected=${collected}`
        );
      }
    }
  }
});

test('validateCreate enforces the floor, the cap, and the window bounds', () => {
  const good = {
    amountMicro: 10n * PI,
    shipWindowS: PARAMS.SHIP_DEFAULT_S,
    inspectWindowS: PARAMS.INSPECT_DEFAULT_S,
    maxAmountMicro: 100n * PI,
  };
  assert.equal(validateCreate(good), null);
  assert.match(validateCreate({ ...good, amountMicro: PI / 2n }) ?? '', /floor/);
  assert.match(validateCreate({ ...good, amountMicro: 200n * PI }) ?? '', /limit/);
  assert.match(validateCreate({ ...good, shipWindowS: 60 }) ?? '', /Ship window/);
  assert.match(validateCreate({ ...good, inspectWindowS: 60 }) ?? '', /Inspection window/);
  assert.equal(validateCreate({ ...good, amountMicro: 500n * PI, maxAmountMicro: null }), null); // unlimited tier
});

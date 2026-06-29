/**
 * Clasp escrow domain model — faithful to PRD §8 (Smart Contract Specification).
 *
 * This module is the single source of the escrow *rules*: the state machine,
 * the parameter bounds, and the money math (bonds, fee, splits). The smart
 * contract on Pi mainnet is the source of financial truth at runtime; this
 * mirror lets the reference app compute and display amounts identically and
 * lets the backend indexer validate transitions before reflecting chain state.
 *
 * All amounts are in micro-Pi (1 Pi = 1_000_000 µPi) integers to avoid float
 * rounding dust. Per PRD §8.4(6), dust remainder always goes to the buyer.
 */

export const MICRO = 1_000_000n;

export function piToMicro(pi: number): bigint {
  // Round to the nearest micro-Pi.
  return BigInt(Math.round(pi * 1_000_000));
}
export function microToPi(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

// ── Parameters (PRD §8.2) ────────────────────────────────────────────────────
export const PARAMS = {
  AMOUNT_CAP: piToMicro(50), // launch cap, bounded blast radius
  AMOUNT_FLOOR: piToMicro(1),
  BOND_PCT: 15n, // 15% of price
  BOND_FLOOR: piToMicro(1),
  FUNDING_WINDOW_S: 24 * 3600, // fixed 24h
  SHIP_MIN_S: 24 * 3600,
  SHIP_MAX_S: 14 * 24 * 3600,
  SHIP_DEFAULT_S: 72 * 3600,
  INSPECT_MIN_S: 24 * 3600,
  INSPECT_MAX_S: 7 * 24 * 3600,
  INSPECT_DEFAULT_S: 72 * 3600,
  SETTLEMENT_WINDOW_S: 7 * 24 * 3600, // fixed
  SETTLEMENT_STEP_PCT: 5n, // proposals in 5% increments
  FEE_PCT: 15n, // 1.5% expressed as 15 / 1000
  FEE_DEN: 1000n,
  FEE_MIN: piToMicro(0.05),
} as const;

// ── State machine (PRD §8.1) ─────────────────────────────────────────────────
export type TradeState =
  | 'CREATED'
  | 'FUNDED'
  | 'SHIPPED'
  | 'DISPUTED'
  | 'COMPLETED'
  | 'SETTLED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'NUCLEAR';

export const TERMINAL_STATES: TradeState[] = [
  'COMPLETED',
  'SETTLED',
  'REFUNDED',
  'CANCELLED',
  'NUCLEAR',
];

/** Non-terminal states, used for "active trade" queries. */
export const NON_TERMINAL: TradeState[] = ['CREATED', 'FUNDED', 'SHIPPED', 'DISPUTED'];

export function isTerminal(state: TradeState): boolean {
  return TERMINAL_STATES.includes(state);
}

export type TradeEventType =
  | 'trade.created'
  | 'trade.funded'
  | 'trade.shipped'
  | 'trade.completed'
  | 'trade.disputed'
  | 'trade.settlement_proposed'
  | 'trade.settled'
  | 'trade.refunded'
  | 'trade.nuclear'
  | 'trade.cancelled';

// ── Bond / fee math ──────────────────────────────────────────────────────────
export function bondFor(amountMicro: bigint): bigint {
  const pct = (amountMicro * PARAMS.BOND_PCT) / 100n;
  return pct > PARAMS.BOND_FLOOR ? pct : PARAMS.BOND_FLOOR;
}

export function feeFor(releasedToSeller: bigint): bigint {
  if (releasedToSeller <= 0n) return 0n;
  const pct = (releasedToSeller * PARAMS.FEE_PCT) / PARAMS.FEE_DEN;
  return pct > PARAMS.FEE_MIN ? pct : PARAMS.FEE_MIN;
}

/** Who pays the separate 1.5% platform fee — chosen by the seller at creation.
 *  The bond is unrelated: BOTH parties always post a bond as security. */
export type FeePayer = 'seller' | 'buyer';

/** Seller locks their security bond at creation (collected via Pi at that point). */
export function sellerLockTotal(amountMicro: bigint): bigint {
  return bondFor(amountMicro);
}

/** Buyer locks price + their security bond at funding, PLUS the platform fee when
 *  the buyer is the one paying it (added on top — never carved out of the price). */
export function buyerLockTotal(amountMicro: bigint, feePayer: FeePayer = 'seller'): bigint {
  return amountMicro + bondFor(amountMicro) + (feePayer === 'buyer' ? feeFor(amountMicro) : 0n);
}

// ── Settlement / payout outcomes ─────────────────────────────────────────────
export interface Payout {
  sellerReceives: bigint;
  buyerReceives: bigint;
  operatorFee: bigint;
  burned: bigint;
}

/**
 * COMPLETED: the operator takes the fee; the seller gets the price (less the fee
 * only if the SELLER is the one paying it) plus their bond back; the buyer gets
 * their bond back. Solvent against what was collected (seller bond + price +
 * buyer bond + buyer-paid fee).
 */
export function completedPayout(amountMicro: bigint, feePayer: FeePayer = 'seller'): Payout {
  const fee = feeFor(amountMicro);
  const bond = bondFor(amountMicro);
  const proceeds = feePayer === 'seller' ? amountMicro - fee : amountMicro;
  return {
    sellerReceives: proceeds + bond,
    buyerReceives: bond, // buyer bond back
    operatorFee: fee,
    burned: 0n,
  };
}

/** REFUNDED: the trade failed — no fee. Buyer gets price + bond + any fee they
 *  pre-paid; seller gets their bond back. */
export function refundedPayout(amountMicro: bigint, feePayer: FeePayer = 'seller'): Payout {
  const bond = bondFor(amountMicro);
  const buyerPrepaidFee = feePayer === 'buyer' ? feeFor(amountMicro) : 0n;
  return {
    sellerReceives: bond, // seller bond back only
    buyerReceives: amountMicro + bond + buyerPrepaidFee, // price + bond + refunded fee
    operatorFee: 0n,
    burned: 0n,
  };
}

/**
 * SETTLED: principal split per accepted proposal (sellerPct of the price to the
 * seller). Fee taken only on the portion released to the seller. Both bonds
 * returned. If the buyer pre-paid the full fee, the unused part is refunded.
 * Dust → buyer (PRD §8.4(6)).
 */
export function settledPayout(amountMicro: bigint, sellerPct: bigint, feePayer: FeePayer = 'seller'): Payout {
  const sellerPrincipal = (amountMicro * sellerPct) / 100n;
  const fee = feeFor(sellerPrincipal); // fee on the portion released to the seller
  const bond = bondFor(amountMicro);
  const buyerPrincipal = amountMicro - sellerPrincipal; // remainder incl. dust → buyer
  const buyerPrepaidFee = feePayer === 'buyer' ? feeFor(amountMicro) : 0n;
  const buyerFeeRefund = buyerPrepaidFee > fee ? buyerPrepaidFee - fee : 0n;
  return {
    sellerReceives: sellerPrincipal - (feePayer === 'seller' ? fee : 0n) + bond,
    buyerReceives: buyerPrincipal + bond + buyerFeeRefund,
    operatorFee: fee,
    burned: 0n,
  };
}

/**
 * NUCLEAR: both bonds forfeited; principal split 50/50. Dust → buyer. No fee
 * (trade failed) — any fee the buyer pre-paid is refunded.
 * Designed never to execute; exists to make settlement the only rational outcome.
 */
export function nuclearPayout(amountMicro: bigint, feePayer: FeePayer = 'seller'): Payout {
  const sellerHalf = amountMicro / 2n; // floor; dust to buyer
  const buyerHalf = amountMicro - sellerHalf;
  const bond = bondFor(amountMicro);
  const buyerPrepaidFee = feePayer === 'buyer' ? feeFor(amountMicro) : 0n;
  return {
    sellerReceives: sellerHalf,
    buyerReceives: buyerHalf + buyerPrepaidFee,
    operatorFee: 0n,
    burned: bond * 2n,
  };
}

// ── Validation for trade creation (PRD §8.2 bounds) ──────────────────────────
export interface CreateTradeInput {
  amountMicro: bigint;
  shipWindowS: number;
  inspectWindowS: number;
  /** The seller's effective per-trade cap (micro-Pi). null = unlimited.
   *  undefined = use the legacy launch cap (for partner/API callers). */
  maxAmountMicro?: bigint | null;
}

export function validateCreate(input: CreateTradeInput): string | null {
  const { amountMicro, shipWindowS, inspectWindowS } = input;
  if (amountMicro < PARAMS.AMOUNT_FLOOR) return 'Amount is below the 1 Pi floor.';
  const cap = input.maxAmountMicro === undefined ? PARAMS.AMOUNT_CAP : input.maxAmountMicro;
  if (cap !== null && amountMicro > cap)
    return `Amount is above your ${microToPi(cap).toLocaleString()} Pi per-trade limit.`;
  if (shipWindowS < PARAMS.SHIP_MIN_S || shipWindowS > PARAMS.SHIP_MAX_S)
    return 'Ship window must be between 24 hours and 14 days.';
  if (inspectWindowS < PARAMS.INSPECT_MIN_S || inspectWindowS > PARAMS.INSPECT_MAX_S)
    return 'Inspection window must be between 24 hours and 7 days.';
  return null;
}

/**
 * Seller trust tiers — the per-trade limit ladder (PRD extension).
 *
 * A seller earns a higher *ceiling* by completing trades that never went into
 * dispute ("qualifying" trades). Crossing a milestone only UNLOCKS the higher
 * ceiling; the seller's effective per-trade cap stays where it is until they
 * opt in (raise it on the settings slider). So a new seller is bounded at 100π
 * and milestones never silently increase a seller's exposure.
 *
 * Qualifying trade = a trade where the user was the seller and it reached
 * COMPLETED. By the state machine, COMPLETED is only reachable from SHIPPED and
 * never from DISPUTED, so "completed and never disputed" is automatic — SETTLED
 * (disputed-then-settled) and NUCLEAR correctly do not count.
 *
 * Isomorphic: imported by both the server (enforcement) and client (UI). All
 * money is micro-Pi bigint, consistent with lib/escrow.ts.
 */
import { piToMicro, microToPi } from './escrow';

export type TierTone = 'slate' | 'brand' | 'info' | 'premium';

export interface Tier {
  id: 0 | 1 | 2 | 3;
  name: string;
  /** Plain-language unlock condition, shown in the UI. */
  blurb: string;
  /** Qualifying (never-disputed completed) trades needed to reach this tier. */
  minQualifying: number;
  /** Earned per-trade ceiling. null = unlimited (Elite). */
  ceilingMicro: bigint | null;
  ceilingPi: number | null;
  tone: TierTone;
}

export const TIERS: Tier[] = [
  { id: 0, name: 'Starter', blurb: 'Every new seller starts here',     minQualifying: 0,   ceilingMicro: piToMicro(100),  ceilingPi: 100,  tone: 'slate' },
  { id: 1, name: 'Trusted', blurb: '50 clean trades, no disputes',     minQualifying: 50,  ceilingMicro: piToMicro(500),  ceilingPi: 500,  tone: 'brand' },
  { id: 2, name: 'Pro',     blurb: '200 clean trades, no disputes',    minQualifying: 200, ceilingMicro: piToMicro(1000), ceilingPi: 1000, tone: 'info' },
  { id: 3, name: 'Elite',   blurb: '500 clean trades, no disputes',    minQualifying: 500, ceilingMicro: null,            ceilingPi: null, tone: 'premium' },
];

/** Default per-trade cap for a brand-new seller (Starter ceiling). */
export const DEFAULT_LIMIT_MICRO = TIERS[0].ceilingMicro as bigint;

/** Highest tier the qualifying count has earned. */
export function tierFor(qualifying: number): Tier {
  let earned = TIERS[0];
  for (const t of TIERS) if (qualifying >= t.minQualifying) earned = t;
  return earned;
}

/** The next tier up, or null if already Elite. */
export function nextTier(qualifying: number): Tier | null {
  const cur = tierFor(qualifying);
  return TIERS.find((t) => t.id === cur.id + 1) ?? null;
}

/** Trades still needed to reach the next tier (0 if at Elite). */
export function tradesToNext(qualifying: number): number {
  const next = nextTier(qualifying);
  return next ? Math.max(0, next.minQualifying - qualifying) : 0;
}

/** Progress (0..1) from the current tier's floor to the next tier's threshold. */
export function tierProgress(qualifying: number): number {
  const cur = tierFor(qualifying);
  const next = nextTier(qualifying);
  if (!next) return 1;
  const span = next.minQualifying - cur.minQualifying;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (qualifying - cur.minQualifying) / span));
}

/** The earned ceiling for a qualifying count (null = unlimited). */
export function ceilingMicroFor(qualifying: number): bigint | null {
  return tierFor(qualifying).ceilingMicro;
}

/**
 * The seller's effective per-trade cap: their chosen cap, never above the earned
 * ceiling. chosenMicro === null means "no self-cap" (only meaningful at Elite →
 * unlimited). Returns null = unlimited.
 */
export function effectiveLimitMicro(qualifying: number, chosenMicro: bigint | null): bigint | null {
  const ceiling = ceilingMicroFor(qualifying);
  if (chosenMicro === null) return ceiling;                 // unlimited at Elite, else full ceiling
  if (ceiling === null) return chosenMicro;                 // Elite with a self-imposed cap
  return chosenMicro < ceiling ? chosenMicro : ceiling;     // clamp chosen to earned ceiling
}

/** Is an amount allowed for this seller? Unlimited (null) always passes. */
export function amountWithinLimit(
  amountMicro: bigint, qualifying: number, chosenMicro: bigint | null,
): boolean {
  const lim = effectiveLimitMicro(qualifying, chosenMicro);
  return lim === null ? true : amountMicro <= lim;
}

/**
 * Clamp a seller's requested cap into the allowed range for their tier.
 * `pi` null = request unlimited (granted only at Elite; otherwise clamped to the
 * earned ceiling). Returns micro-Pi, or null for a granted-unlimited cap.
 */
export function clampChosenLimit(qualifying: number, pi: number | null): bigint | null {
  const ceiling = ceilingMicroFor(qualifying);
  if (pi === null) return ceiling === null ? null : ceiling; // unlimited only honoured at Elite
  let micro = piToMicro(pi);
  const floor = piToMicro(1);
  if (micro < floor) micro = floor;
  if (ceiling !== null && micro > ceiling) micro = ceiling;
  return micro;
}

/** Human label for a limit (null = "Unlimited"). */
export function limitLabel(micro: bigint | null): string {
  return micro === null ? 'Unlimited' : `${microToPi(micro).toLocaleString()} π`;
}

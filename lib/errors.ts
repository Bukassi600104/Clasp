/**
 * Domain errors shared by the persistence layer and the escrow engine.
 * Lives in its own module so `lib/db/*` can throw TransitionError without
 * importing `lib/store.ts` (which imports the repo — would be a cycle).
 */

/** An escrow state transition that the state machine forbids. Mapped to HTTP 409. */
export class TransitionError extends Error {}

export function isTransitionError(e: unknown): e is TransitionError {
  return e instanceof TransitionError;
}

import 'server-only';

/**
 * Chain seam — the single boundary between the app and the on-chain Soroban
 * escrow contract (see `contract/`). Today `lib/store.ts` is the source of trade
 * state (the in-process engine that mirrors the contract). When the contract is
 * deployed to Pi mainnet, this module becomes the integration point and the
 * data flow inverts to the PRD §7 architecture:
 *
 *   WRITES  — user-signed contract calls. The reference app builds the operation
 *             and the **Pi Wallet signs it** client-side (lib/pi-client.ts). The
 *             backend never holds keys and never moves funds.
 *   READS   — `get_trade` / `get_state` via Pi RPC (read-only simulation).
 *   INDEXER — a worker polls contract events (every transition emits one) and
 *             writes them into Firestore via the same repository the engine uses,
 *             so the API and UI are unchanged. Webhooks fire from the indexer
 *             AFTER on-chain confirmation, never from optimistic state (§9).
 *
 * Until `NEXT_PUBLIC_CONTRACT_ADDRESS` is set, `contractConfigured()` is false
 * and `lib/store.ts` runs the engine directly. This keeps the app fully
 * functional pre-mainnet and makes the cutover a config flip, not a rewrite.
 */

export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? null;
export const PI_RPC_URL = process.env.PI_RPC_URL ?? 'https://api.mainnet.minepi.com/rpc';
export const PI_TOKEN_SAC = process.env.PI_TOKEN_SAC ?? null;

export function contractConfigured(): boolean {
  return !!CONTRACT_ID;
}

/** The contract's write surface (mirrors `contract/src/lib.rs`). Each call is a
 *  wallet-signed transaction; the app builds the invocation, Pi Wallet signs. */
export type ContractFn =
  | 'create_trade'
  | 'fund_trade'
  | 'cancel_unfunded'
  | 'mark_shipped'
  | 'confirm_receipt'
  | 'open_dispute'
  | 'propose_settlement'
  | 'accept_settlement'
  | 'claim_timeout';

export interface ContractCall {
  contractId: string;
  fn: ContractFn;
  args: unknown[];
}

/** Build an invocation descriptor for the Pi Wallet to sign (client-side). */
export function buildCall(fn: ContractFn, args: unknown[]): ContractCall {
  if (!CONTRACT_ID) throw new Error('Contract address not configured.');
  return { contractId: CONTRACT_ID, fn, args };
}

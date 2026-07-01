import 'server-only';

/**
 * Chain seam — the intended boundary between the app and the on-chain Soroban
 * escrow contract (see `contract/`). Today `lib/store.ts` is the source of trade
 * state (the in-process engine that mirrors the contract), and funds move through
 * the custodial Pi payment bridge (`Pi.createPayment`), NOT through a contract.
 *
 * KNOWN BLOCKER (verified against pi-apps/pi-platform-docs SDK_reference.md):
 * the WRITES path below assumes the Pi Wallet can sign a contract invocation
 * client-side. The public Pi JS SDK exposes no such method — only
 * `authenticate` / `createPayment` (payments) / share / ads. So this seam cannot
 * be activated for end users until Pi ships wallet-signed contract calls. The
 * code below is a descriptor builder only; it does not sign or submit anything.
 *
 *   WRITES  — (BLOCKED) would be user-signed contract calls.
 *   READS   — `get_trade` / `get_state` via Pi RPC (read-only simulation).
 *   INDEXER — a worker polls contract events and mirrors them into Firestore.
 *
 * Until `NEXT_PUBLIC_CONTRACT_ADDRESS` is set, `contractConfigured()` is false
 * and `lib/store.ts` runs the engine directly.
 */

export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? null;
// Default matches the network the app actually runs on today (Pi Testnet);
// set PI_RPC_URL for mainnet at cutover.
export const PI_RPC_URL = process.env.PI_RPC_URL ?? 'https://api.testnet.minepi.com/rpc';
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

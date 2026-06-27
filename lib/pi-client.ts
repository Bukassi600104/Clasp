'use client';

/**
 * Thin, typed wrapper around the Pi SDK (window.Pi) loaded from
 * https://sdk.minepi.com/pi-sdk.js. The app only ever runs inside Pi Browser.
 *
 * Compliance (PRD §4):
 *  - Pi Authentication is the ONLY login. No email/password.
 *  - The app never sees private keys or passphrases — all signing happens in
 *    Pi Wallet. We only handle access tokens + payment identifiers.
 *  - Access tokens are verified server-side with the secret Pi Platform API key.
 */

export type PiScope = 'username' | 'payments' | 'wallet_address';

export interface PiAuthResult {
  accessToken: string;
  user: { uid: string; username: string };
}

export interface PiPaymentData {
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
}

export interface PiPaymentCallbacks {
  onReadyForServerApproval: (paymentId: string) => void;
  onReadyForServerCompletion: (paymentId: string, txid: string) => void;
  onCancel: (paymentId: string) => void;
  onError: (error: Error, payment?: unknown) => void;
}

interface PiSDK {
  // Pi.init may resolve asynchronously — callers must await it fully.
  init(config: { version: string; sandbox?: boolean }): Promise<void> | void;
  authenticate(
    scopes: PiScope[],
    onIncompletePaymentFound: (payment: { identifier: string }) => void
  ): Promise<PiAuthResult>;
  createPayment(data: PiPaymentData, callbacks: PiPaymentCallbacks): void;
  openShareDialog?(title: string, message: string): void;
}

declare global {
  interface Window {
    Pi?: PiSDK;
  }
}

let initialized = false;

const SANDBOX = process.env.NEXT_PUBLIC_PI_SANDBOX === 'true';

function rawPi(): PiSDK {
  if (typeof window === 'undefined' || !window.Pi) {
    throw new Error(
      'Pi SDK not available. Open Clasp inside the Pi Browser to continue.'
    );
  }
  return window.Pi;
}

/**
 * Initialize the Pi SDK exactly once. `Pi.init` may return a Promise, so we
 * await it fully before any authenticate/payment call (per the Pi SDK guide).
 */
async function ensureInit(): Promise<PiSDK> {
  const Pi = rawPi();
  if (!initialized) {
    await Promise.resolve(Pi.init({ version: '2.0', sandbox: SANDBOX }));
    initialized = true;
  }
  return Pi;
}

export function isPiBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.Pi;
}

/**
 * Authenticate the pioneer. We request `username` + `payments`. Any incomplete
 * payment from a previous session is handed to the server to reconcile so funds
 * are never stranded.
 */
export async function authenticate(): Promise<PiAuthResult> {
  const Pi = await ensureInit();
  // Sign-in requests only the `username` scope (the documented, reliable auth
  // flow). The `payments` scope is requested later, at the point of locking
  // funds — bundling it here can make authenticate stall before the app's
  // payment setup is complete.
  return Pi.authenticate(['username'], async (payment) => {
    try {
      await fetch('/api/payments/incomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: payment.identifier }),
      });
    } catch {
      /* server reconciles on next indexer pass */
    }
  });
}

/**
 * Run the wallet payment flow for locking funds into a trade. The payment is
 * approved and completed server-side (the secret API key never ships to the
 * client). `metadata` carries the trade id so the backend can bind the payment.
 */
export function createPayment(
  data: PiPaymentData,
  handlers: {
    onApprovalRequested: (paymentId: string) => Promise<void>;
    onCompletionRequested: (paymentId: string, txid: string) => Promise<void>;
    onCancel?: () => void;
    onError?: (error: Error) => void;
  }
): void {
  // Pi allows only ONE pending payment per user. If a previous trade left a
  // payment unresolved (e.g. it expired before completion), Pi surfaces it via
  // onIncompletePaymentFound — and a NEW createPayment will hang until it times
  // out ("The approval process has timed out") unless that leftover is cleared
  // FIRST. Capture the reconcile call and AWAIT it before starting the new
  // payment, rather than firing it off and racing ahead into createPayment.
  let reconcile: Promise<void> = Promise.resolve();

  ensureInit()
    // Request the payments scope just-in-time (sign-in only granted `username`).
    .then((Pi) =>
      Pi.authenticate(['username', 'payments'], (payment) => {
        reconcile = fetch('/api/payments/incomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId: payment.identifier }),
        })
          .then(() => undefined)
          .catch(() => undefined /* reconciled on next indexer pass */);
      }).then(() => Pi)
    )
    .then(async (Pi) => {
      // Block until any leftover payment is cancelled/completed server-side, so
      // Pi isn't still holding a pending payment when we open the new one.
      await reconcile;
      Pi.createPayment(data, {
        onReadyForServerApproval: (paymentId) => {
          handlers.onApprovalRequested(paymentId).catch((e) =>
            handlers.onError?.(e as Error)
          );
        },
        onReadyForServerCompletion: (paymentId, txid) => {
          handlers.onCompletionRequested(paymentId, txid).catch((e) =>
            handlers.onError?.(e as Error)
          );
        },
        onCancel: () => handlers.onCancel?.(),
        onError: (error) => handlers.onError?.(error),
      });
    })
    .catch((e) => handlers.onError?.(e as Error));
}

/** Native Pi share sheet when available, falling back to the Web Share API. */
export async function sharePayLink(title: string, message: string, url: string) {
  if (typeof window !== 'undefined' && window.Pi?.openShareDialog) {
    window.Pi.openShareDialog(title, `${message}\n\n${url}`);
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    await navigator.share({ title, text: message, url });
    return;
  }
  await navigator.clipboard?.writeText(`${message}\n${url}`);
}

// Minimal type surface for the official Pi App-to-User backend SDK (npm: pi-backend).
// The package ships no types; this declares only what lib/pi-payout.ts uses.
declare module 'pi-backend' {
  export interface A2UPaymentArgs {
    amount: number;
    memo: string;
    metadata: Record<string, unknown>;
    uid: string;
  }
  export interface PiPaymentDTO {
    identifier: string;
    transaction: { txid: string; verified: boolean } | null;
    status?: Record<string, boolean>;
  }
  export default class PiNetwork {
    constructor(apiKey: string, walletPrivateSeed: string);
    createPayment(args: A2UPaymentArgs): Promise<string>;
    submitPayment(paymentId: string): Promise<string>;
    completePayment(paymentId: string, txid: string): Promise<PiPaymentDTO>;
    getPayment(paymentId: string): Promise<PiPaymentDTO>;
    cancelPayment(paymentId: string): Promise<PiPaymentDTO>;
    getIncompleteServerPayments(): Promise<PiPaymentDTO[]>;
  }
}

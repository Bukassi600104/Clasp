'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/app/providers';
import { api } from '@/lib/client-api';
import { createPayment, isPiBrowser } from '@/lib/pi-client';
import { useLiveTrade } from '@/lib/use-live-trade';
import type { Trade, PublicStats } from '@/lib/types';
import { buyerLockTotal, bondFor, feeFor, microToPi } from '@/lib/escrow';
import { formatPi, windowLabel } from '@/lib/format';
import { Logo } from '@/components/brand';
import { HeroAmount, MoneyRow } from '@/components/money';
import { TrustBadge } from '@/components/trust-badge';
import { Lock, Shield, Truck, Clock, Check, Scale } from '@/components/icons';

/**
 * Buyer checkout. The payment runs through a visible three-step tracker:
 * awaiting Pi approval, submitting to the Pi network, confirmed. The current
 * step persists per trade in sessionStorage, and the page subscribes to the
 * trade's live stream, so backgrounding Pi Browser mid payment and coming back
 * resumes the tracker where it was instead of starting over.
 */
type PayStep = 'idle' | 'approving' | 'signing' | 'confirming' | 'done';

const stepKey = (tradeId: string) => `clasp_pay_${tradeId}`;

function readStep(tradeId: string): PayStep {
  try {
    const v = sessionStorage.getItem(stepKey(tradeId));
    return v === 'approving' || v === 'signing' || v === 'confirming' ? v : 'idle';
  } catch { return 'idle'; }
}

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, signIn, signingIn } = useAuth();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [sellerStats, setSellerStats] = useState<PublicStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStepState] = useState<PayStep>('idle');
  const resumed = useRef(false);

  const setStep = useCallback((next: PayStep, tradeId: string) => {
    setStepState(next);
    try {
      if (next === 'idle' || next === 'done') sessionStorage.removeItem(stepKey(tradeId));
      else sessionStorage.setItem(stepKey(tradeId), next);
    } catch { /* storage blocked: the live stream still resolves the outcome */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api.trade(id);
      setTrade(d.trade);
      setSellerStats(d.sellerStats);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the trade.');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useLiveTrade(id, load);

  // Resume: if a payment was mid flight when the user backgrounded the app,
  // show the tracker again instead of the pay button.
  useEffect(() => {
    if (resumed.current || !trade) return;
    resumed.current = true;
    const stored = readStep(trade.id);
    if (stored !== 'idle' && trade.state === 'CREATED') setStepState(stored);
  }, [trade]);

  // Success (from this tab, another tab, or a resumed background payment):
  // the trade left CREATED. Clear the tracker and open the trade view.
  useEffect(() => {
    if (!trade || trade.state === 'CREATED') return;
    const hadPayment = step !== 'idle' || readStep(trade.id) !== 'idle';
    setStep('done', trade.id);
    router.replace(`/trade/${trade.id}${hadPayment && trade.state === 'FUNDED' ? '?funded=1' : ''}`);
  }, [trade, step, setStep, router]);

  if (err) return <Centered>{err}</Centered>;
  if (!trade) return <Centered>Loading the trade…</Centered>;
  if (trade.state !== 'CREATED') return <Centered>Opening trade…</Centered>;
  if (user && trade.seller_uid === user.uid) {
    router.replace(`/trade/${trade.id}`);
    return <Centered>Opening your trade…</Centered>;
  }
  // The seller must post their security bond before the trade can be funded.
  if (trade.seller_bond_paid === false) {
    return <Centered>This trade is not live yet. The seller still needs to post their security bond.</Centered>;
  }

  const amount = BigInt(trade.amount_micro);
  const buyerBond = bondFor(amount);
  const buyerFee = trade.fee_payer === 'buyer' ? feeFor(amount) : 0n;
  const total = buyerLockTotal(amount, trade.fee_payer);
  const paying = step !== 'idle' && step !== 'done';

  async function lockFunds() {
    if (!user) { await signIn(); return; }
    if (!trade) return;
    setErr(null);
    try {
      if (isPiBrowser()) {
        setStep('approving', trade.id);
        await new Promise<void>((resolve, reject) => {
          createPayment(
            {
              amount: microToPi(total),
              memo: `Clasp escrow · ${trade.memo}`.slice(0, 64),
              metadata: { tradeId: trade.id, kind: 'escrow_lock' },
            },
            {
              onApprovalRequested: async (paymentId) => {
                await api.approvePayment(paymentId, trade.id);
                setStep('signing', trade.id);
              },
              onCompletionRequested: async (paymentId, txid) => {
                setStep('confirming', trade.id);
                await api.completePayment(paymentId, txid, trade.id);
                resolve();
              },
              onCancel: () => reject(new Error('Payment cancelled.')),
              onError: (e) => reject(e),
            }
          );
        });
      } else {
        // Sandbox / preview path: record the lock directly.
        setStep('confirming', trade.id);
        await api.fund(trade.id);
      }
      setStep('done', trade.id);
      router.push(`/trade/${trade.id}?funded=1`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Payment failed.');
      setStep('idle', trade.id);
    }
  }

  return (
    <div className="flex flex-col min-h-[100dvh] hexgrid">
      <header className="px-5 pt-6 flex items-center justify-between">
        <Logo size="sm" />
        <span className="chip bg-brand-soft text-brand">
          <Shield width={13} height={13} /> Escrow protected
        </span>
      </header>

      <main className="px-5 pt-6 pb-44">
        {/* The 10-second trust statement */}
        <div className="text-center">
          <h1 className="font-display text-[26px] font-semibold tracking-tight leading-tight glow-text">
            Pay safely with escrow
          </h1>
          <p className="mt-2 text-[15px] text-muted leading-relaxed">
            <span className="font-semibold text-ink">@{trade.seller_username}</span> wants{' '}
            {formatPi(trade.amount_micro)} for this. Clasp holds your payment in escrow.
            The seller <span className="font-semibold text-ink">cannot touch it</span> until you confirm delivery.
          </p>
        </div>

        {/* Live payment tracker, once a payment starts */}
        {paying && <PaySteps step={step} />}

        {/* Seller track record — public trust signal */}
        <div className="mt-5">
          <TrustBadge stats={sellerStats} username={trade.seller_username} role="Seller" />
        </div>

        <div className="card mt-4 p-5">
          <p className="text-[13px] font-semibold text-faint uppercase tracking-wider">You are buying</p>
          <p className="mt-1.5 text-[17px] font-medium text-ink">{trade.memo}</p>
          <div className="hr my-4" />
          <HeroAmount micro={total} caption="Total you lock now" />
        </div>

        {/* How it works, three calm steps */}
        <div className="mt-6 space-y-3">
          <Step n={1} Icon={Lock} title="You lock the payment"
            body="It goes into escrow, not the seller's wallet." />
          <Step n={2} Icon={Truck} title="The seller ships"
            body={`They have ${windowLabel(trade.ship_window_s)} to send it, or you get refunded in full.`} />
          <Step n={3} Icon={Check} title="You confirm and they get paid"
            body={`You have ${windowLabel(trade.inspect_window_s)} to check it and release the funds.`} />
        </div>

        {/* Amount breakdown */}
        <div className="card mt-6 p-4">
          <MoneyRow label="Item price" micro={amount} />
          <div className="hr" />
          <MoneyRow label="Your refundable bond" micro={buyerBond}
            sub="Comes back when the trade completes" />
          {buyerFee > 0n && (
            <>
              <div className="hr" />
              <MoneyRow label="Platform commission (1.5%)" micro={buyerFee}
                sub="The seller asked the buyer to cover this" />
            </>
          )}
          <div className="hr" />
          <MoneyRow label="Total to lock" micro={total} emphasis />
        </div>

        {/* Dispute terms, one collapsible line */}
        <details className="card mt-4 p-4 bg-slate-soft ring-0 group">
          <summary className="flex gap-3 items-center cursor-pointer list-none select-none">
            <Scale width={18} height={18} className="text-slate shrink-0" />
            <span className="text-[13px] font-semibold text-slate flex-1">Dispute terms in plain language</span>
            <span className="text-faint text-[12px] group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <p className="mt-3 text-[13px] leading-relaxed text-slate">
            Both sides post a small refundable bond. If something goes wrong you open a
            dispute and agree on a fair split. Nobody at Clasp decides your money. The bond
            returns to you on any honest outcome.
          </p>
        </details>
      </main>

      {/* Lock CTA */}
      <div className="sticky bottom-0 px-5 pt-4 pb-[max(env(safe-area-inset-bottom),18px)] bg-paper/92 backdrop-blur-md">
        <div className="hr mb-4" />
        <button onClick={lockFunds} disabled={paying || signingIn} className="btn-primary w-full">
          <Lock width={18} height={18} />
          {paying ? 'Payment in progress' : !user ? 'Sign in with Pi to continue' : `Lock ${formatPi(total)} safely`}
        </button>
        {err && <p className="mt-3 text-center text-[13px] text-danger">{err}</p>}
        <p className="mt-3 text-center text-[12px] text-faint">
          Signing happens in your Pi Wallet. Clasp never sees your keys.
        </p>
      </div>
    </div>
  );
}

/* Live three-step payment tracker. Each visible step owns its microcopy; the
 * active one pulses. If the user backgrounds Pi Browser and returns, this
 * renders from the persisted step, not from zero. */
function PaySteps({ step }: { step: PayStep }) {
  const STEPS = [
    { label: 'Awaiting Pi approval', sub: 'Confirming the amount with the escrow server', Icon: Shield },
    { label: 'Submitting to the Pi network', sub: 'Sign in your Pi Wallet, then the chain does its part', Icon: Lock },
    { label: 'Confirmed', sub: 'Funds locked in escrow', Icon: Check },
  ];
  const activeIndex = step === 'approving' ? 0 : step === 'signing' || step === 'confirming' ? 1 : 2;
  return (
    <div className="card mt-5 p-4 animate-fade-up" role="status" aria-live="polite">
      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const done = i < activeIndex || step === 'done';
          const active = i === activeIndex && step !== 'done';
          return (
            <li key={s.label} className="flex items-center gap-3">
              <span className={`grid place-items-center h-8 w-8 rounded-full shrink-0 ${
                done ? 'bg-brand text-brand-ink shadow-glow'
                : active ? 'bg-brand-soft text-brand ring-1 ring-brand/50'
                : 'bg-surface ring-1 ring-line text-faint'
              }`}>
                {done ? <Check width={15} height={15} strokeWidth={2.4} /> : <s.Icon width={15} height={15} />}
              </span>
              <div className="min-w-0">
                <p className={`text-[14px] font-semibold ${done || active ? 'text-ink' : 'text-faint'}`}>
                  {s.label}{active && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand animate-pulse-dot align-middle" />}
                </p>
                {active && <p className="text-[12px] text-muted mt-0.5">{s.sub}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Step({ n, Icon, title, body }: { n: number; Icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="flex gap-3.5 items-start">
      <span className="grid place-items-center h-9 w-9 shrink-0 rounded-xl bg-brand-soft text-brand text-[13px] font-bold tnum ring-1 ring-brand/25">
        {n}
      </span>
      <div className="flex-1 pt-0.5">
        <div className="flex items-center gap-2">
          <Icon width={16} height={16} className="text-brand" />
          <h3 className="font-semibold text-[15px]">{title}</h3>
        </div>
        <p className="text-[13px] text-muted mt-0.5 leading-snug">{body}</p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] grid place-items-center px-8 text-center text-[15px] text-muted">
      {children}
    </div>
  );
}

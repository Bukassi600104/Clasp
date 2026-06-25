'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/app/providers';
import { api } from '@/lib/client-api';
import { createPayment, isPiBrowser } from '@/lib/pi-client';
import type { Trade, PublicStats } from '@/lib/types';
import { buyerLockTotal, bondFor, microToPi } from '@/lib/escrow';
import { formatPi, windowLabel } from '@/lib/format';
import { Logo } from '@/components/brand';
import { HeroAmount, MoneyRow } from '@/components/money';
import { TrustBadge } from '@/components/trust-badge';
import { Lock, Shield, Truck, Clock, Check, Scale } from '@/components/icons';

export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, signIn, signingIn } = useAuth();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [sellerStats, setSellerStats] = useState<PublicStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.trade(id).then((d) => { setTrade(d.trade); setSellerStats(d.sellerStats); }).catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <Centered>{err}</Centered>;
  if (!trade) return <Centered>Loading the trade…</Centered>;

  // If already funded/terminal, or the viewer owns it, send to the detail view.
  if (trade.state !== 'CREATED') {
    router.replace(`/trade/${trade.id}`);
    return <Centered>Opening trade…</Centered>;
  }
  if (user && trade.seller_uid === user.uid) {
    router.replace(`/trade/${trade.id}`);
    return <Centered>Opening your trade…</Centered>;
  }

  const amount = BigInt(trade.amount_micro);
  const buyerBond = bondFor(amount);
  const total = buyerLockTotal(amount);

  async function lockFunds() {
    if (!user) { await signIn(); return; }
    setBusy(true);
    setErr(null);
    try {
      if (isPiBrowser()) {
        setStatus('Opening Pi Wallet…');
        await new Promise<void>((resolve, reject) => {
          createPayment(
            {
              amount: microToPi(total),
              memo: `Clasp escrow · ${trade!.memo}`.slice(0, 64),
              metadata: { tradeId: trade!.id, kind: 'escrow_lock' },
            },
            {
              onApprovalRequested: async (paymentId) => {
                setStatus('Confirming with the contract…');
                await api.approvePayment(paymentId, trade!.id);
              },
              onCompletionRequested: async (paymentId, txid) => {
                setStatus('Locking funds…');
                await api.completePayment(paymentId, txid, trade!.id);
                resolve();
              },
              onCancel: () => reject(new Error('Payment cancelled.')),
              onError: (e) => reject(e),
            }
          );
        });
      } else {
        // Sandbox / preview path: record the lock directly.
        setStatus('Locking funds…');
        await api.fund(trade!.id);
      }
      router.push(`/trade/${trade!.id}?funded=1`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Payment failed.');
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <header className="px-5 pt-6 flex items-center justify-between">
        <Logo size="sm" />
        <span className="chip bg-brand-soft text-brand-dark">
          <Shield width={13} height={13} /> Escrow protected
        </span>
      </header>

      <main className="px-5 pt-6 pb-44">
        {/* The 10-second trust statement */}
        <div className="text-center">
          <h1 className="font-display text-[26px] font-semibold tracking-tight leading-tight">
            Pay safely with escrow
          </h1>
          <p className="mt-2 text-[15px] text-muted leading-relaxed">
            <span className="font-semibold text-ink">@{trade.seller_username}</span> wants{' '}
            {formatPi(trade.amount_micro)} for this. Clasp holds your payment in escrow —
            they <span className="font-semibold text-ink">cannot touch it</span> until you confirm delivery.
          </p>
        </div>

        {/* Seller track record — public trust signal */}
        <div className="mt-5">
          <TrustBadge stats={sellerStats} username={trade.seller_username} role="Seller" />
        </div>

        <div className="card mt-4 p-5">
          <p className="text-[13px] font-semibold text-faint uppercase tracking-wider">You're buying</p>
          <p className="mt-1.5 text-[17px] font-medium text-ink">{trade.memo}</p>
          <div className="hr my-4" />
          <HeroAmount micro={total} caption="Total you lock now" />
        </div>

        {/* How it works — 3 calm steps */}
        <div className="mt-6 space-y-3">
          <Step n={1} Icon={Lock} title="You lock the payment"
            body="It goes into the contract, not the seller's wallet." />
          <Step n={2} Icon={Truck} title="The seller ships"
            body={`They have ${windowLabel(trade.ship_window_s)} to send it, or you're auto-refunded in full.`} />
          <Step n={3} Icon={Check} title="You confirm — they get paid"
            body={`You have ${windowLabel(trade.inspect_window_s)} to check it and release the funds.`} />
        </div>

        {/* Amount breakdown */}
        <div className="card mt-6 p-4">
          <MoneyRow label="Item price" micro={amount} />
          <div className="hr" />
          <MoneyRow label="Your refundable bond" micro={buyerBond}
            sub="Comes back when the trade completes" />
          <div className="hr" />
          <MoneyRow label="Total to lock" micro={total} emphasis />
        </div>

        {/* Reassurance on bond + dispute */}
        <div className="card mt-4 p-4 bg-slate-soft ring-0">
          <div className="flex gap-3">
            <Scale width={18} height={18} className="text-slate shrink-0 mt-0.5" />
            <p className="text-[13px] leading-relaxed text-slate">
              The small bond keeps both sides honest. If something goes wrong, you open a
              dispute and settle on a fair split — <span className="font-semibold">no operator decides your money</span>.
              The bond returns to you on any honest outcome.
            </p>
          </div>
        </div>
      </main>

      {/* Lock CTA */}
      <div className="sticky bottom-0 px-5 pt-4 pb-[max(env(safe-area-inset-bottom),18px)] bg-paper/92 backdrop-blur-md">
        <div className="hr mb-4" />
        <button onClick={lockFunds} disabled={busy || signingIn} className="btn-primary w-full">
          <Lock width={18} height={18} />
          {busy ? (status ?? 'Working…') : !user ? 'Sign in with Pi to continue' : `Lock ${formatPi(total)} safely`}
        </button>
        {err && <p className="mt-3 text-center text-[13px] text-danger">{err}</p>}
        <p className="mt-3 text-center text-[12px] text-faint">
          Signing happens in your Pi Wallet. Clasp never sees your keys.
        </p>
      </div>
    </div>
  );
}

function Step({ n, Icon, title, body }: { n: number; Icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="flex gap-3.5 items-start">
      <span className="grid place-items-center h-9 w-9 shrink-0 rounded-xl bg-sink text-white text-[13px] font-bold tnum">
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

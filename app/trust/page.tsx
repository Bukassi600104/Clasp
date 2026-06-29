'use client';

import { useState } from 'react';
import { AppBar } from '@/components/chrome';
import { Lock, Shield, Scale, Flame, Copy, Check, PiSymbol } from '@/components/icons';

const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '';

export default function TrustPage() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!CONTRACT) return;
    await navigator.clipboard?.writeText(CONTRACT);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <AppBar title="How your money stays safe" back />

      <main className="px-5 pt-4 pb-12 space-y-5">
        <p className="text-[15px] text-muted leading-relaxed">
          Clasp holds your payment in escrow and releases it only by clear,
          published rules — never by our judgment of who &ldquo;wins&rdquo; a trade.
          Here is exactly how.
        </p>

        <Guarantee Icon={Lock} title="Held in escrow, released by the rules">
          When a buyer pays, Clasp holds the Pi in escrow — the seller cannot reach
          it until the buyer confirms delivery, the inspection window passes, or a
          dispute is settled. If the seller never ships, it&apos;s auto-refunded.
        </Guarantee>

        <Guarantee Icon={Scale} title="No human ever judges a dispute">
          There is no support agent who decides outcomes. Disputes are resolved by
          incentive design: both sides post a bond and negotiate a split.
          Settling always beats walking away.
        </Guarantee>

        <Guarantee Icon={Flame} title="We only earn on successful trades">
          The only money Clasp earns is the 1.5% platform fee on trades that
          complete or settle. There are no fees on disputes, refunds, or
          cancellations.
        </Guarantee>

        <Guarantee Icon={Shield} title="We never see your keys">
          You sign every action inside your own Pi Wallet. Clasp only ever
          handles your username and the trade details — never a passphrase or a
          private key.
        </Guarantee>

        {/* Official app — anti-phishing */}
        <div className="card p-5 bg-sink ring-0">
          <div className="flex items-center gap-2 text-white">
            <PiSymbol width={18} height={18} />
            <p className="text-[13px] font-semibold uppercase tracking-wider text-white/60">
              The official Clasp app
            </p>
          </div>
          <p className="mt-2 text-[13px] text-white/75 leading-relaxed">
            Always check the link. Clasp never asks for payment over DM — the only
            official app runs at this address:
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/10 px-3.5 h-12">
            <span className="flex-1 truncate text-[13px] text-white/85 tnum">
              {CONTRACT || 'claspescrow.com'}
            </span>
            {CONTRACT && (
              <button onClick={copy} className="shrink-0 grid place-items-center h-8 w-8 rounded-lg bg-white/15 text-white active:scale-95">
                {copied ? <Check width={16} height={16} /> : <Copy width={16} height={16} />}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-[12px] text-faint leading-relaxed px-2">
          Performance bonds, not wagers. Outcomes depend only on what the buyer and
          seller do — never on chance.
        </p>
      </main>
    </div>
  );
}

function Guarantee({ Icon, title, children }: { Icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex gap-3.5">
        <span className="grid place-items-center h-11 w-11 shrink-0 rounded-xl bg-brand-soft text-brand-dark">
          <Icon width={22} height={22} />
        </span>
        <div>
          <h3 className="font-semibold text-[15px] text-ink leading-snug">{title}</h3>
          <p className="text-[13.5px] text-muted leading-relaxed mt-1">{children}</p>
        </div>
      </div>
    </div>
  );
}

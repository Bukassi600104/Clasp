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
          Clasp is infrastructure, not a middleman. We built it so that even we
          cannot take your Pi or decide who wins a trade. Here is exactly how.
        </p>

        <Guarantee Icon={Lock} title="Funds live in the contract, not a wallet">
          When a buyer pays, the Pi goes straight into an on-chain smart contract.
          No Clasp wallet ever holds it. The seller cannot reach it until the
          buyer confirms, and a no-show triggers an automatic refund.
        </Guarantee>

        <Guarantee Icon={Scale} title="No human ever judges a dispute">
          There is no support agent who decides outcomes. Disputes are resolved by
          incentive design: both sides post a bond and negotiate a split on-chain.
          Settling always beats walking away.
        </Guarantee>

        <Guarantee Icon={Flame} title="We never profit from failure">
          The only money Clasp earns is a 1.5% fee on trades that complete
          successfully. Bonds forfeited in the worst case are burned to a
          provably unspendable address — never collected by us.
        </Guarantee>

        <Guarantee Icon={Shield} title="We never see your keys">
          You sign every action inside your own Pi Wallet. Clasp only ever
          handles your username and the trade details — never a passphrase or a
          private key.
        </Guarantee>

        {/* Contract address — anti-phishing */}
        <div className="card p-5 bg-sink ring-0">
          <div className="flex items-center gap-2 text-white">
            <PiSymbol width={18} height={18} />
            <p className="text-[13px] font-semibold uppercase tracking-wider text-white/60">
              Official contract address
            </p>
          </div>
          <p className="mt-2 text-[13px] text-white/75 leading-relaxed">
            Always check the link. Clasp never asks for payment over DM and only
            ever uses this contract:
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/10 px-3.5 h-12">
            <span className="flex-1 truncate text-[13px] text-white/85 tnum">
              {CONTRACT || 'Published at mainnet launch'}
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

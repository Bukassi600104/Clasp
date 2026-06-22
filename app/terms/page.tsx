import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/brand';
import { ArrowLeft } from '@/components/icons';

export const metadata: Metadata = {
  title: 'Terms of Service — Clasp',
  description: 'Clasp is non-custodial escrow for Pi commerce. It never holds funds, never decides disputes, never reverses a transaction.',
};

const UPDATED = 'June 2026';
const CONTACT = 'bukassi@gmail.com';

export default function TermsPage() {
  return (
    <main className="px-5 py-8 max-w-app mx-auto">
      <header className="flex items-center justify-between mb-7">
        <Logo size="sm" />
        <Link href="/" className="text-[13px] font-semibold text-muted inline-flex items-center gap-1">
          <ArrowLeft width={16} height={16} /> Back
        </Link>
      </header>

      <h1 className="font-display text-[28px] font-semibold tracking-tight">Terms of Service</h1>
      <p className="text-[13px] text-faint mt-1">Last updated: {UPDATED}</p>

      <Section title="What Clasp is">
        <p>Clasp is non-custodial escrow infrastructure for the Pi Network. It provides a smart contract that locks Pi until delivery is confirmed, plus an app and API to use it. <b>Clasp is not a marketplace, a bank, or a custodian.</b></p>
      </Section>

      <Section title="What Clasp does not do">
        <Bullet>It never holds your funds. Pi only ever sits inside the on-chain contract.</Bullet>
        <Bullet>It never decides disputes. Outcomes are determined by you, your counterparty, and the contract’s deadline rules — never by an operator.</Bullet>
        <Bullet>It never reverses, freezes, or claws back a transaction.</Bullet>
      </Section>

      <Section title="Bonds">
        <p>Both parties post a refundable performance bond (15% of the price, floor 1 Pi). Bonds are returned on any honest outcome. In the “nuclear” outcome (no settlement reached in time), both bonds are burned to a provably unspendable address — never collected by the operator.</p>
      </Section>

      <Section title="Fees">
        <p>A 1.5% fee (minimum 0.05 Pi) is charged by the contract on the amount released to the seller, and only when a trade completes or settles. There are no fees on disputes, refunds, or cancellations.</p>
      </Section>

      <Section title="Your responsibilities">
        <Bullet>Verify the official contract address (shown in-app under “How your money stays safe”). Clasp never requests payment via direct message.</Bullet>
        <Bullet>Ship and confirm within the agreed windows. Missing a deadline triggers an automatic, permissionless on-chain outcome that nobody can override.</Bullet>
      </Section>

      <Section title="Acceptable use">
        <p>Pi only. No gambling, no illegal goods, and no activity prohibited by Pi’s developer guidelines. Performance bonds are a centuries-old construction-contract mechanism, not a wager — outcomes are determined entirely by participant actions, never by chance.</p>
      </Section>

      <Section title="No warranty">
        <p>The service is provided “as is”, without warranties of any kind. Smart contracts carry inherent risk; trade amounts are capped at launch to bound exposure. Use at your own discretion. To the maximum extent permitted by law, the operator is not liable for losses arising from your use of the service or from the behaviour of your counterparty.</p>
      </Section>

      <Section title="Contact">
        <p>
          Operator: <b>Tony Orjiako</b> (Clasp).{' '}
          <a href={`mailto:${CONTACT}`} className="text-brand-dark font-semibold underline underline-offset-2">{CONTACT}</a>.
        </p>
      </Section>

      <p className="mt-8 text-[13px] text-faint">
        See also our{' '}
        <Link href="/privacy" className="text-brand-dark font-semibold underline underline-offset-2">Privacy Policy</Link>.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-[14.5px] text-muted leading-relaxed [&_b]:text-ink">
        {children}
      </div>
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2.5">
      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand shrink-0" />
      <span>{children}</span>
    </p>
  );
}

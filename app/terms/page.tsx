import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/brand';
import { ArrowLeft } from '@/components/icons';

export const metadata: Metadata = {
  title: 'Terms of Service — Clasp',
  description: 'Clasp is a custodial escrow service for Pi commerce. It holds the buyer’s payment until delivery is confirmed and never decides disputes by operator judgment.',
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
        <p>Clasp is a <b>custodial escrow service</b> for the Pi Network. It holds the buyer’s payment and both parties’ bonds in a secured Clasp app wallet until the trade reaches an outcome, then releases the funds strictly according to the published rules below. Clasp is not a marketplace or a bank, and does not give financial advice.</p>
      </Section>

      <Section title="What Clasp does not do">
        <Bullet>It does not spend, lend, or invest the funds it holds in escrow. They are held only to settle your trade.</Bullet>
        <Bullet>It never decides disputes by judgment. Outcomes are determined by you, your counterparty, and Clasp’s published deadline rules — never by an operator’s opinion.</Bullet>
        <Bullet>It never reverses, freezes, or seizes funds outside those outcome rules.</Bullet>
      </Section>

      <Section title="Bonds">
        <p>Both parties post a refundable security bond (15% of the price, floor 1 Pi) — the seller at creation, the buyer when funding. Bonds are returned on any honest outcome. If no settlement is reached in time (the “nuclear” outcome), both bonds are forfeited and are not returned to either party.</p>
      </Section>

      <Section title="Platform fee">
        <p>A 1.5% platform fee (minimum 0.05 Pi) applies only when a trade completes or settles — never on disputes, refunds, or cancellations. The fee is separate from the bond and from the item price. At creation the seller chooses who pays it (seller or buyer); it is shown as its own line before anyone pays.</p>
      </Section>

      <Section title="Your responsibilities">
        <Bullet>Only ever transact through the official Clasp app at claspescrow.com (and its official PiNet entry). Clasp never requests payment via direct message.</Bullet>
        <Bullet>Ship and confirm within the agreed windows. Missing a deadline triggers an automatic outcome under Clasp’s rules that the counterparty cannot override.</Bullet>
      </Section>

      <Section title="Acceptable use">
        <p>Pi only. No gambling, no illegal goods, and no activity prohibited by Pi’s developer guidelines. Performance bonds are a centuries-old construction-contract mechanism, not a wager — outcomes are determined entirely by participant actions, never by chance.</p>
      </Section>

      <Section title="No warranty">
        <p>The service is provided “as is”, without warranties of any kind. Holding funds in custody and on-chain transfers carry inherent risk; trade amounts are capped at launch to bound exposure. Use at your own discretion. To the maximum extent permitted by law, the operator is not liable for losses arising from your use of the service or from the behaviour of your counterparty.</p>
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

import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/brand';
import { ArrowLeft } from '@/components/icons';

export const metadata: Metadata = {
  title: 'Privacy Policy — Clasp',
  description: 'How Clasp handles your data: minimal and Pi-only. We never see your wallet keys or passphrase.',
};

const UPDATED = 'June 2026';
const CONTACT = 'bukassi@gmail.com';

export default function PrivacyPage() {
  return (
    <main className="px-5 py-8 max-w-app mx-auto">
      <header className="flex items-center justify-between mb-7">
        <Logo size="sm" />
        <Link href="/" className="text-[13px] font-semibold text-muted inline-flex items-center gap-1">
          <ArrowLeft width={16} height={16} /> Back
        </Link>
      </header>

      <h1 className="font-display text-[28px] font-semibold tracking-tight">Privacy Policy</h1>
      <p className="text-[13px] text-faint mt-1">Last updated: {UPDATED}</p>

      <p className="mt-5 text-[15px] text-muted leading-relaxed">
        Clasp is a custodial escrow app for the Pi Network: it holds the buyer&apos;s payment
        until delivery is confirmed, then releases it by the trade&apos;s rules. We collect the
        minimum data needed to run a safe trade, and we never see your wallet keys or passphrase.
      </p>

      <Section title="What we collect">
        <Bullet><b>Pi identity:</b> your Pi <code>uid</code> and <code>username</code>, obtained only through Pi Authentication when you sign in.</Bullet>
        <Bullet><b>Trade metadata:</b> amounts (in Pi), item descriptions, time windows, deadlines, trade state, and on-chain transaction references.</Bullet>
        <Bullet><b>Dispute evidence:</b> images and notes you choose to upload during a dispute, shared only with your counterparty.</Bullet>
      </Section>

      <Section title="What we never collect">
        <Bullet>No private keys or wallet passphrases — ever. All signing happens inside Pi Wallet.</Bullet>
        <Bullet>No email, password, phone number, or fiat/payment-card data.</Bullet>
        <Bullet>No Pi market-value, price, or valuation data.</Bullet>
      </Section>

      <Section title="How we use it">
        <p>Solely to display trade state, send deadline reminders and notifications, and compute your reputation (weighted by distinct verified counterparties). We never sell your data. The secret Pi Platform API key is used server-side only and is never exposed to the client. Your Pi access token is verified server-side against Pi’s <code>/me</code> endpoint and never stored.</p>
      </Section>

      <Section title="Data sharing">
        <p>We do not share your data with third parties for advertising. Dispute evidence is visible only to the buyer and seller of that trade. Aggregate, non-identifying trust signals (e.g. your count of completed trades) are shown to counterparties so they can trade safely.</p>
      </Section>

      <Section title="Retention & deletion">
        <p>Trade records are retained for dispute integrity and on-chain consistency. You may request deletion of off-chain metadata (notifications, evidence) by emailing us. On-chain records are immutable by nature and cannot be deleted.</p>
      </Section>

      <Section title="Security">
        <p>Data is transmitted over HTTPS and stored with access controls. The app runs entirely inside Pi Browser and authenticates only via Pi. We apply rate limiting and standard protections against abuse.</p>
      </Section>

      <Section title="Contact">
        <p>
          Operator: <b>Tony Orjiako</b> (Clasp). Questions or data requests:{' '}
          <a href={`mailto:${CONTACT}`} className="text-brand-dark font-semibold underline underline-offset-2">{CONTACT}</a>.
        </p>
      </Section>

      <p className="mt-8 text-[13px] text-faint">
        See also our{' '}
        <Link href="/terms" className="text-brand-dark font-semibold underline underline-offset-2">Terms of Service</Link>.
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-2 space-y-2 text-[14.5px] text-muted leading-relaxed [&_code]:text-ink [&_code]:bg-paper [&_code]:px-1 [&_code]:rounded [&_b]:text-ink">
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

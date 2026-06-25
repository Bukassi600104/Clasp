import Link from 'next/link';
import { tierFor, nextTier, tradesToNext, tierProgress } from '@/lib/tiers';
import { TierBadge } from './tier-badge';
import { ArrowRight } from './icons';

/**
 * Compact, unobtrusive tier/qualifying-trades meter for the dashboard — tier
 * badge, the seller's clean-trade count, and a thin flat progress bar toward the
 * next milestone. One row tall; never covers other content. Flat (no gradient).
 */
export function TierMeter({ qualifying, href = '/profile' }: { qualifying: number; href?: string }) {
  const tier = tierFor(qualifying);
  const next = nextTier(qualifying);
  const toNext = tradesToNext(qualifying);
  const pct = Math.round(tierProgress(qualifying) * 100);

  return (
    <Link href={href} className="card block p-4 active:scale-[0.99] transition">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TierBadge name={tier.name} tone={tier.tone} className="!py-0.5 !px-2 shrink-0" />
          <span className="text-[13px] text-muted truncate">
            <span className="font-semibold text-ink tnum">{qualifying}</span> clean trade{qualifying === 1 ? '' : 's'}
          </span>
        </div>
        {next ? (
          <span className="text-[12px] text-faint whitespace-nowrap flex items-center gap-1">
            <span className="tnum">{toNext}</span> to {next.name}
            <ArrowRight width={13} height={13} />
          </span>
        ) : (
          <span className="text-[12px] font-semibold text-brand-dark whitespace-nowrap">Top tier · unlimited</span>
        )}
      </div>
      {next && (
        <div className="mt-2.5 h-1.5 rounded-full bg-paper overflow-hidden" aria-hidden>
          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
      )}
    </Link>
  );
}

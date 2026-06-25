import type { PublicStats } from '@/lib/types';
import { Shield, Check, User } from './icons';
import { FeedbackPill } from './feedback';
import { TierBadge } from './tier-badge';

/**
 * Public trust signal — a compact stats strip a counterparty sees before they
 * transact (the cross-platform P2P standard: name + tier badge, a rating score,
 * and a one-line `N trades · X% completion · Y people` strip). Reputation is
 * weighted by distinct counterparties — Pi's one-person-one-account verification
 * makes sybil farming pointless — which we surface alongside the raw count.
 */
export function TrustBadge({
  stats,
  username,
  role = 'Seller',
}: {
  stats: PublicStats | null;
  username?: string | null;
  role?: 'Seller' | 'Buyer';
}) {
  const n = stats?.successful ?? 0;
  const trusted = n >= 5 && (stats?.completion_rate ?? 0) >= 90;
  const rating = role === 'Seller' ? stats?.seller_rating : stats?.buyer_rating;
  const showTier = role === 'Seller' && !!stats?.tier;

  return (
    <div className="card p-4 flex items-center gap-3">
      <span
        className={`grid place-items-center h-11 w-11 rounded-full shrink-0 ${
          trusted ? 'bg-brand-soft text-brand-dark' : 'bg-slate-soft text-muted'
        }`}
      >
        {trusted ? <Shield width={20} height={20} /> : <User width={20} height={20} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-[15px] font-semibold text-ink truncate">@{username ?? stats?.username ?? 'pioneer'}</p>
          {showTier && <TierBadge name={stats!.tier.name} tone={stats!.tier.tone} className="!py-0.5 !px-2" />}
          {trusted && (
            <span className="chip bg-brand-soft text-brand-dark !py-0.5 !px-2">
              <Check width={12} height={12} /> Trusted
            </span>
          )}
        </div>
        {n > 0 ? (
          <p className="text-[13px] text-muted mt-0.5">
            <span className="font-semibold text-brand-dark tnum">{n}</span> safe trade{n === 1 ? '' : 's'}
            {stats?.completion_rate != null && <> · <span className="tnum">{stats.completion_rate}%</span> completion</>}
            {stats && stats.distinct_counterparties > 0 && (
              <> · <span className="tnum">{stats.distinct_counterparties}</span> {stats.distinct_counterparties === 1 ? 'person' : 'people'}</>
            )}
          </p>
        ) : (
          <p className="text-[13px] text-faint mt-0.5">
            New to Clasp — no completed trades yet. The escrow still protects you fully.
          </p>
        )}
      </div>

      {rating && rating.count > 0 && (
        <div className="shrink-0 pl-1">
          <FeedbackPill summary={rating} />
        </div>
      )}
    </div>
  );
}

import type { PublicStats } from '@/lib/types';
import { Shield, Check, User } from './icons';

/**
 * Public trust signal — shows how many successful (completed + settled) trades a
 * user has done, so a counterparty can gauge their track record. Reputation is
 * weighted by distinct counterparties (Pi's one-person-one-account verification
 * makes sybil farming pointless), which we surface alongside the raw count.
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
        <div className="flex items-center gap-1.5">
          <p className="text-[15px] font-semibold text-ink truncate">@{username ?? stats?.username ?? 'pioneer'}</p>
          {trusted && (
            <span className="chip bg-brand-soft text-brand-dark !py-0.5 !px-2">
              <Check width={12} height={12} /> Trusted
            </span>
          )}
        </div>
        {n > 0 ? (
          <p className="text-[13px] text-muted mt-0.5">
            <span className="font-semibold text-brand-dark tnum">{n}</span> safe trade{n === 1 ? '' : 's'} completed
            {stats && stats.distinct_counterparties > 0 && (
              <> · with <span className="tnum">{stats.distinct_counterparties}</span> different {stats.distinct_counterparties === 1 ? 'person' : 'people'}</>
            )}
          </p>
        ) : (
          <p className="text-[13px] text-faint mt-0.5">
            New to Clasp — no completed trades yet. The escrow still protects you fully.
          </p>
        )}
      </div>
    </div>
  );
}

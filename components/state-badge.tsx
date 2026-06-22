import type { TradeState } from '@/lib/escrow';

const MAP: Record<TradeState, { label: string; cls: string; dot: string }> = {
  CREATED:   { label: 'Awaiting payment', cls: 'bg-info-soft text-info',     dot: 'bg-info' },
  FUNDED:    { label: 'Funds locked',     cls: 'bg-brand-soft text-brand-dark', dot: 'bg-brand' },
  SHIPPED:   { label: 'Shipped',          cls: 'bg-slate-soft text-slate',    dot: 'bg-slate' },
  DISPUTED:  { label: 'In dispute',       cls: 'bg-warn-soft text-warn',      dot: 'bg-warn' },
  COMPLETED: { label: 'Completed',        cls: 'bg-brand-soft text-brand-dark', dot: 'bg-brand' },
  SETTLED:   { label: 'Settled',          cls: 'bg-brand-soft text-brand-dark', dot: 'bg-brand' },
  REFUNDED:  { label: 'Refunded',         cls: 'bg-info-soft text-info',      dot: 'bg-info' },
  CANCELLED: { label: 'Cancelled',        cls: 'bg-slate-soft text-muted',    dot: 'bg-faint' },
  NUCLEAR:   { label: 'Nuclear',          cls: 'bg-danger-soft text-danger',  dot: 'bg-danger' },
};

export function StateBadge({ state }: { state: TradeState }) {
  const s = MAP[state];
  return (
    <span className={`chip ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

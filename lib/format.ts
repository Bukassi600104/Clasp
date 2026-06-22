import { microToPi } from './escrow';

/** Format a micro-Pi string/bigint as "12.50 π" with sensible precision. */
export function formatPi(micro: string | bigint, opts: { symbol?: boolean } = {}): string {
  const value = microToPi(typeof micro === 'string' ? BigInt(micro) : micro);
  const fixed = Number.isInteger(value) ? value.toFixed(0) : trimZeros(value.toFixed(6));
  return opts.symbol === false ? fixed : `${fixed} π`;
}

function trimZeros(s: string): string {
  return s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

/** Human countdown like "2d 4h", "3h 12m", "8m", or "ended". */
export function countdown(deadline: string | null): string {
  if (!deadline) return '—';
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function isUrgent(deadline: string | null): boolean {
  if (!deadline) return false;
  const ms = new Date(deadline).getTime() - Date.now();
  return ms > 0 && ms < 2 * 3600 * 1000; // under 2h
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function windowLabel(seconds: number): string {
  const h = seconds / 3600;
  if (h % 24 === 0) return `${h / 24} day${h / 24 === 1 ? '' : 's'}`;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

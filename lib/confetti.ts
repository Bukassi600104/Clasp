'use client';

import confetti from 'canvas-confetti';

/**
 * Celebration for a cleanly completed trade. Fires exactly once per trade per
 * device (localStorage guard), only for clean completions (never disputes,
 * refunds, or nuclear outcomes), and not at all when the user prefers reduced
 * motion. Two short bursts in the brand palette; the whole thing is under a
 * second, then it gets out of the way.
 */
export function celebrateCompletion(tradeId: string): void {
  const key = `clasp_confetti_${tradeId}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    return; // no storage, no way to guarantee "once" — skip rather than spam
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#1FC6FF', '#54D4FF', '#EDF3F8'];
  confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors, disableForReducedMotion: true });
  setTimeout(() => {
    confetti({ particleCount: 50, spread: 100, origin: { y: 0.6 }, scalar: 0.8, colors, disableForReducedMotion: true });
  }, 250);
}

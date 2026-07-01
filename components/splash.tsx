'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * First-launch intro: three swipeable cards explaining what Clasp is, how a
 * trade runs, and why it stays honest. Shows once per device (localStorage),
 * dismissible from every card. Swipe on touch, arrow keys on desktop, dots and
 * Skip everywhere. Pure presentation; no data dependencies.
 */
const SEEN_KEY = 'clasp_intro_seen_v1';

const CARDS = [
  {
    title: 'Sell anywhere. Get paid safely.',
    body: 'Clasp is escrow for Pi commerce. The payment sits in escrow, not in the seller’s wallet, until the trade is done. No trust required between strangers.',
    art: 'shield' as const,
  },
  {
    title: 'A trade in three beats',
    body: 'The seller creates a trade and shares one link. The buyer pays into escrow. When the buyer confirms delivery, the funds release. That’s the whole dance.',
    art: 'beats' as const,
  },
  {
    title: 'Honesty is the cheapest option',
    body: 'Both sides post a small security bond. Walk away from a trade and you lose yours. See it through and it comes back in full, every time.',
    art: 'bonds' as const,
  },
];

export function Splash() {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setVisible(true);
    } catch { /* storage blocked: skip the intro rather than trap the user */ }
  }, []);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  }, []);

  const goTo = useCallback((i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const clamped = Math.max(0, Math.min(CARDS.length - 1, i));
    rail.scrollTo({ left: clamped * rail.clientWidth, behavior: 'smooth' });
  }, []);

  // Track which card is in view as the user swipes.
  const onScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setIndex(Math.round(rail.scrollLeft / rail.clientWidth));
  }, []);

  // Arrow keys on desktop.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, index, goTo, dismiss]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-paper hexgrid flex flex-col" role="dialog" aria-label="Welcome to Clasp">
      {/* Skip */}
      <div className="flex justify-end px-5 pt-[max(env(safe-area-inset-top),20px)]">
        <button onClick={dismiss} className="btn-ghost btn-sm !h-9">
          Skip
        </button>
      </div>

      {/* Cards rail */}
      <div
        ref={railRef}
        onScroll={onScroll}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
      >
        {CARDS.map((c, i) => (
          <section
            key={c.art}
            className="min-w-full snap-center flex flex-col items-center justify-center px-8 text-center"
            aria-hidden={index !== i}
          >
            <Art kind={c.art} />
            <h2 className="mt-8 font-display text-[28px] leading-tight font-semibold tracking-tight glow-text max-w-[320px]">
              {c.title}
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted max-w-[320px]">{c.body}</p>
          </section>
        ))}
      </div>

      {/* Dots + CTA */}
      <div className="px-8 pb-[max(env(safe-area-inset-bottom),28px)] space-y-6">
        <div className="flex justify-center gap-2" role="tablist" aria-label="Intro progress">
          {CARDS.map((c, i) => (
            <button
              key={c.art}
              role="tab"
              aria-selected={index === i}
              aria-label={`Card ${i + 1} of ${CARDS.length}`}
              onClick={() => goTo(i)}
              className={`h-2 rounded-full transition-all duration-300 ${
                index === i ? 'w-7 bg-brand shadow-glow' : 'w-2 bg-line hover:bg-faint'
              }`}
            />
          ))}
        </div>
        {index === CARDS.length - 1 ? (
          <button onClick={dismiss} className="btn-primary w-full animate-fade-up">
            Start trading safely
          </button>
        ) : (
          <button onClick={() => goTo(index + 1)} className="btn-ghost w-full">
            Next
          </button>
        )}
      </div>
    </div>
  );
}

/* Neon wireframe illustrations — inline SVG, single cyan stroke, no assets. */
function Art({ kind }: { kind: 'shield' | 'beats' | 'bonds' }) {
  const stroke = '#1FC6FF';
  const dim = 'rgba(31,198,255,0.35)';
  if (kind === 'shield') {
    return (
      <svg width="180" height="180" viewBox="0 0 180 180" fill="none" aria-hidden className="drop-shadow-[0_0_18px_rgba(31,198,255,0.35)]">
        <path d="M90 18 150 42v46c0 34-24 60-60 74-36-14-60-40-60-74V42z" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M90 34 136 52v36c0 26-18 46-46 58-28-12-46-32-46-58V52z" stroke={dim} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M66 92l16 16 32-34" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'beats') {
    return (
      <svg width="220" height="160" viewBox="0 0 220 160" fill="none" aria-hidden className="drop-shadow-[0_0_18px_rgba(31,198,255,0.35)]">
        <circle cx="38" cy="80" r="24" stroke={stroke} strokeWidth="2.5" />
        <path d="M38 70v20M28 80h20" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M70 80h26m0 0-8-8m8 8-8 8" stroke={dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="128" cy="80" r="24" stroke={stroke} strokeWidth="2.5" />
        <path d="M128 66v18l10 8" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M160 80h22m0 0-8-8m8 8-8 8" stroke={dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M196 62l14 18-14 18" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="200" height="170" viewBox="0 0 200 170" fill="none" aria-hidden className="drop-shadow-[0_0_18px_rgba(31,198,255,0.35)]">
      <path d="M100 22v28" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M40 50h120" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M40 50 24 92h32z" stroke={dim} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M160 50l-16 42h32z" stroke={dim} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M24 92c0 10 7 16 16 16s16-6 16-16" stroke={stroke} strokeWidth="2.5" />
      <path d="M144 92c0 10 7 16 16 16s16-6 16-16" stroke={stroke} strokeWidth="2.5" />
      <path d="M84 130h32M100 108v22" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="100" cy="86" r="14" stroke={stroke} strokeWidth="2.5" />
    </svg>
  );
}

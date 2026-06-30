'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/providers';
import { api } from '@/lib/client-api';
import type { Trade, TradeEvent, PublicStats, Rating } from '@/lib/types';
import {
  isTerminal, bondFor, buyerLockTotal, completedPayout, refundedPayout, nuclearPayout, microToPi,
} from '@/lib/escrow';
import { createPayment, isPiBrowser } from '@/lib/pi-client';
import { formatPi, formatDate } from '@/lib/format';
import { AppBar } from '@/components/chrome';
import { StateBadge } from '@/components/state-badge';
import { Countdown } from '@/components/countdown';
import { Timeline } from '@/components/timeline';
import { ShareCard } from '@/components/share-card';
import { TrustBadge } from '@/components/trust-badge';
import { MoneyRow } from '@/components/money';
import { Sheet } from '@/components/sheet';
import { FeedbackPicker, FeedbackBadge } from '@/components/feedback';
import { Truck, Check, Scale, Lock, Shield, Flame, ArrowRight, ExternalLink, ThumbsUp } from '@/components/icons';

export default function TradeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [events, setEvents] = useState<TradeEvent[]>([]);
  const [sellerStats, setSellerStats] = useState<PublicStats | null>(null);
  const [buyerStats, setBuyerStats] = useState<PublicStats | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [shipOpen, setShipOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.trade(id);
      setTrade(d.trade);
      setEvents(d.events);
      setSellerStats(d.sellerStats);
      setBuyerStats(d.buyerStats);
      setRatings(d.ratings ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load trade.');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (err) return <Centered>{err}</Centered>;
  if (!trade) return <Centered>Loading…</Centered>;

  const isSeller = user?.uid === trade.seller_uid;
  const isBuyer = user?.uid === trade.buyer_uid;
  const amount = BigInt(trade.amount_micro);
  const justCreated = search.get('created') === '1';
  const justFunded = search.get('funded') === '1';

  async function act(fn: () => Promise<Trade>) {
    setBusy(true); setErr(null);
    try { await fn(); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Action failed.'); }
    finally { setBusy(false); }
  }

  // Seller posts (or re-attempts) their security bond — the trade is not live and
  // cannot be funded until this completes. Reuses the Pi payment flow; in
  // sandbox/preview it records the bond without a real payment.
  async function postBond() {
    if (!trade) return;
    setBusy(true); setErr(null);
    try {
      if (isPiBrowser()) {
        setStatus('Posting your bond…');
        await new Promise<void>((resolve, reject) => {
          createPayment(
            {
              amount: microToPi(bondFor(BigInt(trade.amount_micro))),
              memo: `Clasp bond · ${trade.memo}`.slice(0, 64),
              metadata: { tradeId: trade.id, kind: 'seller_bond' },
            },
            {
              onApprovalRequested: (pid) => api.approvePayment(pid, trade.id, 'seller_bond').then(() => undefined),
              onCompletionRequested: (pid, txid) => api.completePayment(pid, txid, trade.id, 'seller_bond').then(() => resolve()),
              onCancel: () => reject(new Error('Bond payment cancelled.')),
              onError: (e) => reject(e),
            }
          );
        });
      } else {
        await api.bond(trade.id);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not post the bond.');
    } finally {
      setBusy(false); setStatus(null);
    }
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <AppBar title="Trade" back right={<StateBadge state={trade.state} />} />

      <main className="px-5 pt-4 pb-44 space-y-5">
        {justCreated && (
          <Banner tone="brand" title="Trade created" body="Your seller bond is locked. Share the link below to get paid." />
        )}
        {justFunded && (
          <Banner tone="brand" title="Funds locked safely" body="The seller has been notified to ship. You'll get a reminder before each deadline." />
        )}

        {/* Hero — dark status card */}
        <div className="card p-5 rounded-3xl bg-sink ring-0 text-white">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-white/50">
            {isSeller ? 'You are selling' : isBuyer ? 'You are buying' : 'Trade'}
          </p>
          <p className="mt-1.5 text-[16px] font-medium text-white/90">{trade.memo}</p>
          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="text-[12px] text-white/50">Amount</p>
              <p className="font-display text-[34px] font-semibold tnum leading-none">{formatPi(trade.amount_micro)}</p>
            </div>
            <NextDeadline trade={trade} light />
          </div>
        </div>

        {/* Counterparty track record */}
        <Counterparty trade={trade} isSeller={isSeller} sellerStats={sellerStats} buyerStats={buyerStats} />

        {/* Mutual rating — once the trade has settled */}
        {(isSeller || isBuyer) && (
          <RatingSection
            trade={trade}
            userUid={user?.uid ?? null}
            ratings={ratings}
            onRated={load}
          />
        )}

        {/* Contextual action region */}
        <ActionRegion
          trade={trade} isSeller={isSeller} isBuyer={isBuyer} busy={busy}
          onShip={() => setShipOpen(true)}
          onConfirm={() => act(() => api.confirm(trade.id))}
          onDispute={() => act(() => api.dispute(trade.id))}
          onCancel={() => act(() => api.cancel(trade.id))}
          onTimeout={() => act(() => api.timeout(trade.id))}
          onReactivate={() => act(() => api.reactivate(trade.id))}
          onPostBond={postBond}
          bondStatus={status}
        />

        {/* Share (seller, awaiting funding) — only after the seller bond is posted */}
        {trade.state === 'CREATED' && isSeller && trade.seller_bond_paid !== false && <ShareCard trade={trade} />}

        {/* Progress */}
        <Timeline trade={trade} />

        {/* Outcome / breakdown */}
        <OutcomeCard trade={trade} amount={amount} />

        {/* Event log */}
        <EventLog events={events} />

        {err && <p className="text-[14px] text-danger">{err}</p>}
      </main>

      {shipOpen && (
        <ShipSheet
          trade={trade}
          onClose={() => setShipOpen(false)}
          onDone={async () => { setShipOpen(false); await load(); }}
        />
      )}
    </div>
  );
}

/* ── Next deadline label ── */
function NextDeadline({ trade, light }: { trade: Trade; light?: boolean }) {
  const map: Record<string, { label: string; d: string | null }> = {
    CREATED: { label: 'Fund by', d: trade.funding_deadline },
    FUNDED: { label: 'Ship by', d: trade.ship_deadline },
    SHIPPED: { label: 'Auto-releases', d: trade.inspect_deadline },
    DISPUTED: { label: 'Settle by', d: trade.settlement_deadline },
  };
  const m = map[trade.state];
  if (!m?.d) return null;
  return (
    <div className="text-right">
      <p className={`text-[12px] ${light ? 'text-white/50' : 'text-faint'}`}>{m.label}</p>
      <Countdown deadline={m.d} className="!text-[15px]" light={light} />
    </div>
  );
}

/* ── Counterparty trust badge ── */
function Counterparty({
  trade, isSeller, sellerStats, buyerStats,
}: {
  trade: Trade; isSeller: boolean; sellerStats: PublicStats | null; buyerStats: PublicStats | null;
}) {
  const showBuyer = isSeller && !!trade.buyer_uid;
  const name = showBuyer ? trade.buyer_username : trade.seller_username;
  if (!name) return null;
  return (
    <TrustBadge
      stats={showBuyer ? buyerStats : sellerStats}
      username={name}
      role={showBuyer ? 'Buyer' : 'Seller'}
    />
  );
}

/* ── Action region ── */
function ActionRegion({
  trade, isSeller, isBuyer, busy, onShip, onConfirm, onDispute, onCancel, onTimeout, onReactivate, onPostBond, bondStatus,
}: {
  trade: Trade; isSeller: boolean; isBuyer: boolean; busy: boolean;
  onShip: () => void; onConfirm: () => void; onDispute: () => void; onCancel: () => void; onTimeout: () => void;
  onReactivate: () => void; onPostBond: () => void; bondStatus: string | null;
}) {
  const deadlinePassed = (d: string | null) => !!d && new Date(d).getTime() <= Date.now();

  // CANCELLED / expired (never funded) — let the seller relist without recreating.
  if (trade.state === 'CANCELLED' && isSeller && !trade.buyer_uid) {
    return (
      <div className="space-y-2">
        <button onClick={onReactivate} disabled={busy} className="btn-primary w-full">
          <ArrowRight width={18} height={18} /> Reactivate this trade
        </button>
        <p className="text-[12px] text-faint text-center">
          Relists it with a fresh 24-hour funding window — the original link works again.
        </p>
      </div>
    );
  }

  // CREATED
  if (trade.state === 'CREATED') {
    if (isSeller) {
      // The seller must post their security bond before the trade goes live.
      if (trade.seller_bond_paid === false) {
        return (
          <div className="space-y-2">
            <button onClick={onPostBond} disabled={busy} className="btn-primary w-full">
              <Shield width={18} height={18} /> {busy ? (bondStatus ?? 'Working…') : `Post your ${formatPi(trade.seller_bond_micro)} security bond`}
            </button>
            <p className="text-[12px] text-faint text-center leading-relaxed">
              This activates the trade. The buyer can’t pay until you post it — and it’s
              returned in full when the trade completes.
            </p>
            <button onClick={onCancel} disabled={busy} className="btn-ghost w-full">Cancel trade</button>
          </div>
        );
      }
      return (
        <div className="grid grid-cols-1 gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-ghost w-full">Cancel trade</button>
        </div>
      );
    }
    // Buyer view — block paying an unbonded trade.
    if (trade.seller_bond_paid === false) {
      return <WaitingNote text="This trade isn’t active yet — the seller still needs to post their security bond." />;
    }
    return (
      <Link href={`/t/${trade.id}`} className="btn-primary w-full">
        <Lock width={18} height={18} /> Pay to lock funds
      </Link>
    );
  }

  // FUNDED
  if (trade.state === 'FUNDED') {
    if (isSeller) {
      return (
        <button onClick={onShip} disabled={busy} className="btn-primary w-full">
          <Truck width={18} height={18} /> Mark as shipped
        </button>
      );
    }
    if (deadlinePassed(trade.ship_deadline)) {
      return (
        <button onClick={onTimeout} disabled={busy} className="btn-primary w-full">
          Claim your refund — seller missed the window
        </button>
      );
    }
    return <WaitingNote text="Waiting for the seller to ship. If they miss the window, you're auto-refunded." />;
  }

  // SHIPPED
  if (trade.state === 'SHIPPED') {
    if (isBuyer) {
      return (
        <div className="space-y-2">
          <button onClick={onConfirm} disabled={busy} className="btn-primary w-full">
            <Check width={18} height={18} /> Confirm receipt & release
          </button>
          <button onClick={onDispute} disabled={busy} className="btn-ghost w-full">
            <Scale width={18} height={18} /> Something's wrong — open dispute
          </button>
        </div>
      );
    }
    if (deadlinePassed(trade.inspect_deadline)) {
      return (
        <button onClick={onTimeout} disabled={busy} className="btn-primary w-full">
          Release payment — inspection window passed
        </button>
      );
    }
    return <WaitingNote text="Buyer is inspecting. If the window passes with no dispute, payment releases to you automatically." />;
  }

  // DISPUTED
  if (trade.state === 'DISPUTED') {
    return (
      <Link href={`/dispute/${trade.id}`} className="btn-danger w-full">
        <Scale width={18} height={18} /> Go to dispute room <ArrowRight width={16} height={16} />
      </Link>
    );
  }

  return null;
}

function WaitingNote({ text }: { text: string }) {
  return (
    <div className="card p-4 bg-slate-soft ring-0 flex gap-3 items-start">
      <Shield width={18} height={18} className="text-slate shrink-0 mt-0.5" />
      <p className="text-[13px] text-slate leading-relaxed">{text}</p>
    </div>
  );
}

/* ── Outcome / amount breakdown ── */
function OutcomeCard({ trade, amount }: { trade: Trade; amount: bigint }) {
  const bond = bondFor(amount);

  if (trade.state === 'COMPLETED') {
    const p = completedPayout(amount, trade.fee_payer);
    return (
      <Breakdown title="Final payout">
        <MoneyRow label="Seller received" micro={p.sellerReceives}
          sub={trade.fee_payer === 'buyer' ? 'Full price + bond back' : 'Price − 1.5% fee + bond back'} />
        <div className="hr" />
        <MoneyRow label="Buyer bond returned" micro={p.buyerReceives} />
        <div className="hr" />
        <MoneyRow label="Platform fee" micro={p.operatorFee}
          sub={`1.5%, paid by the ${trade.fee_payer === 'buyer' ? 'buyer' : 'seller'}`} />
      </Breakdown>
    );
  }
  if (trade.state === 'REFUNDED') {
    const p = refundedPayout(amount, trade.fee_payer);
    return (
      <Breakdown title="Refund settled">
        <MoneyRow label="Buyer refunded" micro={p.buyerReceives} sub="Price + bond, in full" />
        <div className="hr" />
        <MoneyRow label="Seller bond returned" micro={p.sellerReceives} />
      </Breakdown>
    );
  }
  if (trade.state === 'NUCLEAR') {
    const p = nuclearPayout(amount, trade.fee_payer);
    return (
      <Breakdown title="Nuclear outcome" danger>
        <div className="flex gap-3 items-start pb-3">
          <Flame width={18} height={18} className="text-danger shrink-0 mt-0.5" />
          <p className="text-[13px] text-danger leading-relaxed">
            No settlement was reached in time. Both bonds were burned and the principal split 50/50.
          </p>
        </div>
        <MoneyRow label="Seller received" micro={p.sellerReceives} />
        <div className="hr" />
        <MoneyRow label="Buyer received" micro={p.buyerReceives} />
        <div className="hr" />
        <MoneyRow label="Bonds burned" micro={p.burned} sign="-" />
      </Breakdown>
    );
  }
  if (trade.state === 'SETTLED') {
    return (
      <Breakdown title="Settled by agreement">
        <MoneyRow label="Amount" micro={amount} />
        <div className="hr" />
        <MoneyRow label="Both bonds returned" micro={bond * 2n} />
      </Breakdown>
    );
  }

  // Active trades: show what's locked
  return (
    <Breakdown title="Locked in the contract">
      <MoneyRow label="Sale price" micro={amount} />
      <div className="hr" />
      <MoneyRow label="Buyer bond" micro={bond} sub={trade.buyer_uid ? 'Locked' : 'Locks on funding'} />
      <div className="hr" />
      <MoneyRow label="Seller bond" micro={bond} sub="Locked at creation" />
      <div className="hr" />
      <MoneyRow label="Total escrowed" micro={trade.buyer_uid ? buyerLockTotal(amount, trade.fee_payer) + bond : bond} emphasis />
    </Breakdown>
  );
}

function Breakdown({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`card p-5 ${danger ? 'ring-danger/20' : ''}`}>
      <h3 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-1">{title}</h3>
      {children}
    </div>
  );
}

/* ── Event log ── */
function EventLog({ events }: { events: TradeEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="card p-5">
      <h3 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-3">On-chain activity</h3>
      <ul className="space-y-3">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-brand shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium text-ink">{labelFor(e.event)}</p>
              <p className="text-[12px] text-faint tnum">{formatDate(e.confirmed_at)}</p>
            </div>
            {e.chain_tx && (
              <a
                href={`https://blockexplorer.minepi.com/mainnet/transactions/${e.chain_tx}`}
                target="_blank" rel="noreferrer"
                className="text-faint hover:text-brand mt-0.5"
                aria-label="View on explorer"
              >
                <ExternalLink width={15} height={15} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function labelFor(event: string): string {
  const map: Record<string, string> = {
    'trade.created': 'Trade created — seller bond locked',
    'trade.funded': 'Buyer locked payment + bond',
    'trade.shipped': 'Seller marked shipped',
    'trade.completed': 'Completed — funds released',
    'trade.disputed': 'Dispute opened',
    'trade.settlement_proposed': 'Settlement proposed',
    'trade.settled': 'Dispute settled',
    'trade.refunded': 'Auto-refunded',
    'trade.nuclear': 'Nuclear — bonds burned',
    'trade.cancelled': 'Trade cancelled',
    'trade.reactivated': 'Trade reactivated — relisted',
    'trade.bonded': 'Seller posted their security bond',
  };
  return map[event] ?? event;
}

/* ── Ship sheet ── */
function ShipSheet({ trade, onClose, onDone }: { trade: Trade; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (note.trim().length < 3) return;
    setBusy(true); setErr(null);
    try { await api.ship(trade.id, note.trim()); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not mark shipped.'); setBusy(false); }
  }

  return (
    <Sheet onClose={onClose} title="Mark as shipped">
      <p className="text-[14px] text-muted leading-relaxed">
        Add proof you sent it — tracking number, a photo reference, or a short note. This is
        recorded on-chain and protects you if the buyer disputes.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 280))}
        rows={3}
        placeholder="e.g. DHL tracking 7712-8830, handed over 14:20 today"
        className="field h-auto py-3 mt-4 resize-none"
      />
      <p className="mt-1.5 text-[12px] text-faint">{note.length}/280</p>
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      <button onClick={submit} disabled={busy || note.trim().length < 3} className="btn-primary w-full mt-4">
        <Truck width={18} height={18} /> {busy ? 'Recording…' : 'Confirm shipment'}
      </button>
    </Sheet>
  );
}

function Banner({ tone, title, body }: { tone: 'brand'; title: string; body: string }) {
  return (
    <div className={`card p-4 bg-brand-soft ring-brand/15 animate-fade-up`}>
      <div className="flex gap-3 items-start">
        <Check width={18} height={18} className="text-brand-dark shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-[14px] text-brand-dark">{title}</p>
          <p className="text-[13px] text-slate mt-0.5 leading-snug">{body}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Mutual rating ── */
function RatingSection({
  trade, userUid, ratings, onRated,
}: {
  trade: Trade; userUid: string | null; ratings: Rating[]; onRated: () => Promise<void> | void;
}) {
  // Only after a funded trade reaches a terminal outcome (has a counterparty).
  if (!isTerminal(trade.state) || !trade.buyer_uid) return null;
  const isParty = userUid === trade.seller_uid || userUid === trade.buyer_uid;
  if (!isParty) return null;

  const myRating = ratings.find((r) => r.rater_uid === userUid) ?? null;
  const aboutMe = ratings.find((r) => r.ratee_uid === userUid) ?? null;
  const counterName =
    userUid === trade.seller_uid ? trade.buyer_username : trade.seller_username;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ThumbsUp width={18} height={18} className="text-brand" />
        <h3 className="font-display text-lg font-semibold">Rate this trade</h3>
      </div>

      {myRating ? (
        <RatedRow label={`You rated @${counterName ?? 'them'}`} rating={myRating} />
      ) : (
        <RateForm tradeId={trade.id} counterName={counterName ?? 'your counterparty'} onRated={onRated} />
      )}

      {aboutMe && (
        <>
          <div className="hr" />
          <RatedRow label={`@${aboutMe.rater_username ?? 'They'} rated you`} rating={aboutMe} />
        </>
      )}
    </div>
  );
}

function RatedRow({ label, rating }: { label: string; rating: Rating }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">{label}</p>
        <FeedbackBadge positive={rating.positive} />
      </div>
      {rating.comment && <p className="mt-1.5 text-[14px] text-ink leading-snug">“{rating.comment}”</p>}
    </div>
  );
}

function RateForm({
  tradeId, counterName, onRated,
}: {
  tradeId: string; counterName: string; onRated: () => Promise<void> | void;
}) {
  const [positive, setPositive] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (positive === null) return;
    setBusy(true); setErr(null);
    try {
      await api.rate(tradeId, positive, comment.trim() || undefined);
      await onRated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit feedback.');
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[13px] text-muted leading-relaxed">
        How was trading with <span className="font-semibold text-ink">@{counterName}</span>? Your feedback
        builds their reputation and helps other pioneers trade with confidence.
      </p>
      <div className="mt-3.5">
        <FeedbackPicker value={positive} onChange={setPositive} />
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, 280))}
        rows={2}
        placeholder="Add a note (optional) — e.g. fast shipping, exactly as described"
        className="field h-auto py-3 mt-3 resize-none"
      />
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      <button onClick={submit} disabled={busy || positive === null} className="btn-primary w-full mt-3">
        {busy ? 'Submitting…' : 'Submit feedback'}
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] grid place-items-center px-8 text-center text-[15px] text-muted">{children}</div>;
}

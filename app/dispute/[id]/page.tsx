'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/app/providers';
import { api } from '@/lib/client-api';
import type { Trade, SettlementProposal, Evidence } from '@/lib/types';
import { settledPayout, nuclearPayout, PARAMS } from '@/lib/escrow';
import { formatPi, formatDate } from '@/lib/format';
import { AppBar } from '@/components/chrome';
import { Countdown } from '@/components/countdown';
import { MoneyRow } from '@/components/money';
import { Scale, Flame, Check, Plus } from '@/components/icons';

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [proposals, setProposals] = useState<SettlementProposal[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [sellerPct, setSellerPct] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api.trade(id);
    setTrade(d.trade);
    setProposals(d.proposals);
    setEvidence(d.evidence);
  }, [id]);

  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  if (err) return <Centered>{err}</Centered>;
  if (!trade) return <Centered>Loading dispute…</Centered>;

  const isSeller = user?.uid === trade.seller_uid;
  const isBuyer = user?.uid === trade.buyer_uid;
  const isParty = isSeller || isBuyer;
  const amount = BigInt(trade.amount_micro);
  const openProposal = proposals.find((p) => p.status === 'open') ?? null;
  const settled = trade.state === 'SETTLED';
  const nuclear = trade.state === 'NUCLEAR';
  const active = trade.state === 'DISPUTED';

  // Pass the trade's fee payer so previews match the payout engine exactly —
  // omitting it defaults to seller-pays and shows wrong numbers on buyer-pays trades.
  const preview = settledPayout(amount, BigInt(sellerPct), trade.fee_payer);
  const nuke = nuclearPayout(amount, trade.fee_payer);

  async function propose() {
    setBusy(true); setErr(null);
    try { await api.propose(trade!.id, sellerPct); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not propose.'); }
    finally { setBusy(false); }
  }
  async function accept(proposalId: string) {
    setBusy(true); setErr(null);
    try { await api.accept(trade!.id, proposalId); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not accept.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col min-h-[100dvh]">
      <AppBar title="Dispute room" back />

      <main className="px-5 pt-4 pb-40 space-y-5">
        {/* Nuclear countdown warning */}
        {active && (
          <div className="card p-5 bg-danger-soft ring-danger/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-danger">
                <Flame width={20} height={20} />
                <span className="font-display text-lg font-semibold">Settle before the clock runs out</span>
              </div>
            </div>
            <p className="mt-2 text-[14px] text-slate leading-relaxed">
              If neither side accepts a split in time, the contract goes <span className="font-semibold text-danger">nuclear</span>:
              both bonds are burned and the price is split 50/50. It's worse for both of you than almost any deal.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[13px] text-muted">Time left to settle:</span>
              <Countdown deadline={trade.settlement_deadline} className="!text-[15px]" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 pt-3 border-t border-danger/15">
              <NukeStat label="Seller would get" value={formatPi(nuke.sellerReceives)} />
              <NukeStat label="Buyer would get" value={formatPi(nuke.buyerReceives)} />
              <NukeStat label="Bonds burned" value={formatPi(nuke.burned)} danger />
              <NukeStat label="Recoverable" value="Never" danger />
            </div>
          </div>
        )}

        {settled && (
          <div className="card p-5 bg-brand-soft ring-brand/15">
            <div className="flex items-center gap-2 text-brand-dark">
              <Check width={20} height={20} />
              <span className="font-display text-lg font-semibold">Settled by agreement</span>
            </div>
            <p className="mt-2 text-[14px] text-slate">Both bonds were returned. No operator decided anything.</p>
          </div>
        )}
        {nuclear && (
          <div className="card p-5 bg-danger-soft ring-danger/20">
            <div className="flex items-center gap-2 text-danger">
              <Flame width={20} height={20} />
              <span className="font-display text-lg font-semibold">Nuclear outcome</span>
            </div>
            <p className="mt-2 text-[14px] text-slate">No settlement was reached. Bonds burned, price split 50/50.</p>
          </div>
        )}

        {/* Settlement slider */}
        {active && isParty && (
          <div className="card p-5">
            <h3 className="font-display text-lg font-semibold">Propose a split</h3>
            <p className="text-[13px] text-muted mt-1">
              Drag to choose how much of the {formatPi(trade.amount_micro)} the seller keeps. Steps of {Number(PARAMS.SETTLEMENT_STEP_PCT)}%.
            </p>

            <div className="mt-5 flex items-center justify-between">
              <SplitPill label="Buyer refund" pct={100 - sellerPct} tone="info" />
              <SplitPill label="Seller keeps" pct={sellerPct} tone="brand" />
            </div>

            <input
              type="range" min={0} max={100} step={Number(PARAMS.SETTLEMENT_STEP_PCT)}
              value={sellerPct}
              onChange={(e) => setSellerPct(parseInt(e.target.value))}
              className="w-full mt-4 accent-brand h-2"
            />

            <div className="mt-4 rounded-xl bg-paper p-3 ring-1 ring-line">
              <MoneyRow label="Seller receives" micro={preview.sellerReceives} sub="Their share − fee + bond back" />
              <div className="hr" />
              <MoneyRow label="Buyer receives" micro={preview.buyerReceives} sub="Their share + bond back" />
            </div>

            <button onClick={propose} disabled={busy} className="btn-primary w-full mt-4">
              <Scale width={18} height={18} /> Propose {sellerPct}% to seller
            </button>
          </div>
        )}

        {/* Open proposal — accept/counter */}
        {active && openProposal && (
          <div className="card p-5">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-faint">Latest offer</h3>
            <p className="mt-2 text-[15px]">
              <span className="font-semibold">
                {openProposal.proposer_uid === trade.seller_uid ? 'Seller' : 'Buyer'}
              </span>{' '}
              proposed <span className="font-semibold text-brand-dark">{openProposal.seller_pct}%</span> to the seller.
            </p>
            {isParty && openProposal.proposer_uid !== user?.uid && (
              <button onClick={() => accept(openProposal.id)} disabled={busy} className="btn-primary w-full mt-4">
                <Check width={18} height={18} /> Accept this split
              </button>
            )}
            {openProposal.proposer_uid === user?.uid && (
              <p className="mt-3 text-[13px] text-muted">Waiting for the other party to accept or counter.</p>
            )}
          </div>
        )}

        {/* Proposal history */}
        {proposals.length > 0 && (
          <div className="card p-5">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-3">Negotiation history</h3>
            <ul className="space-y-2.5">
              {proposals.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-[14px]">
                  <span className="text-muted">
                    {p.proposer_uid === trade.seller_uid ? 'Seller' : 'Buyer'} → {p.seller_pct}% to seller
                  </span>
                  <span className={`chip ${
                    p.status === 'accepted' ? 'bg-brand-soft text-brand-dark'
                    : p.status === 'open' ? 'bg-info-soft text-info' : 'bg-slate-soft text-faint'
                  }`}>{p.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Evidence exchange */}
        {(isParty || evidence.length > 0) && (
          <EvidenceExchange
            trade={trade}
            evidence={evidence}
            uid={user?.uid}
            canAdd={isParty && (active || trade.state === 'SHIPPED')}
            onAdded={load}
            onError={setErr}
          />
        )}

        {!isParty && <Centered>Only the buyer and seller can act in this dispute.</Centered>}
        {err && <p className="text-[14px] text-danger">{err}</p>}
      </main>
    </div>
  );
}

function EvidenceExchange({
  trade, evidence, uid, canAdd, onAdded, onError,
}: {
  trade: Trade;
  evidence: Evidence[];
  uid?: string;
  canAdd: boolean;
  onAdded: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [caption, setCaption] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickImage(file: File) {
    if (file.size > 500_000) { onError('Image must be under 500 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!caption.trim() && !image) { onError('Add a note or an image.'); return; }
    setBusy(true);
    try {
      await api.addEvidence(trade.id, { caption: caption.trim() || undefined, image: image ?? undefined });
      setCaption(''); setImage(null);
      await onAdded();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add evidence.');
    } finally { setBusy(false); }
  }

  const who = (u: string) =>
    u === uid ? 'You' : u === trade.seller_uid ? 'Seller' : 'Buyer';

  return (
    <div className="card p-5">
      <h3 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-1">Evidence</h3>
      <p className="text-[13px] text-muted mb-3">
        Photos and notes are shared with the other party only. No operator reviews them — they exist to help you agree on a fair split.
      </p>

      {evidence.length === 0 && <p className="text-[14px] text-faint py-2">No evidence shared yet.</p>}

      <ul className="space-y-3">
        {evidence.map((e) => (
          <li key={e.id} className="rounded-xl bg-paper ring-1 ring-line p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="chip bg-slate-soft text-muted">{who(e.uploader_uid)}</span>
              <span className="text-[12px] text-faint">{formatDate(e.created_at)}</span>
            </div>
            {e.storage_path.startsWith('data:image') && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.storage_path} alt="evidence" className="w-full rounded-lg ring-1 ring-line mb-2" />
            )}
            {e.caption && <p className="text-[14px] text-ink">{e.caption}</p>}
          </li>
        ))}
      </ul>

      {canAdd && (
        <div className="mt-4 pt-4 border-t border-line">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="preview" className="w-full rounded-lg ring-1 ring-line mb-2" />
          )}
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Describe the issue (e.g. ‘Item arrived cracked — photo attached’)"
            rows={2}
            className="field !h-auto py-2.5 resize-none"
          />
          <div className="flex items-center gap-3 mt-3">
            <label className="btn-ghost btn-sm cursor-pointer">
              <Plus width={16} height={16} /> Photo
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
            </label>
            <button onClick={submit} disabled={busy} className="btn-primary btn-sm flex-1">
              Share evidence
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SplitPill({ label, pct, tone }: { label: string; pct: number; tone: 'brand' | 'info' }) {
  return (
    <div className="text-center">
      <p className={`font-display text-2xl font-semibold tnum ${tone === 'brand' ? 'text-brand-dark' : 'text-info'}`}>{pct}%</p>
      <p className="text-[12px] text-faint">{label}</p>
    </div>
  );
}

function NukeStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <p className="text-[12px] text-faint">{label}</p>
      <p className={`text-[15px] font-semibold tnum ${danger ? 'text-danger' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-[14px] text-muted">{children}</div>;
}

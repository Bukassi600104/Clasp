'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet } from './sheet';
import { ArrowDownLeft } from './icons';

/** Buyer entry point: paste a Clasp pay-link (or trade id) to open its checkout. */
export function OpenLinkSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function open() {
    const id = parseTradeId(value.trim());
    if (!id) {
      setErr('Paste a full Clasp link or a trade id.');
      return;
    }
    router.push(`/t/${id}`);
    onClose();
  }

  return (
    <Sheet title="Open a payment link" onClose={onClose}>
      <p className="text-[14px] text-muted leading-relaxed">
        Got a Clasp link from a seller? Paste it here to see the trade and lock your
        payment safely.
      </p>
      <input
        autoFocus
        value={value}
        onChange={(e) => { setValue(e.target.value); setErr(null); }}
        placeholder="https://…/t/  or  trade id"
        className="field mt-4"
      />
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      <button onClick={open} disabled={!value.trim()} className="btn-primary w-full mt-4">
        <ArrowDownLeft width={18} height={18} /> Open trade
      </button>
    </Sheet>
  );
}

/** Accept a full `/t/<id>` URL, any URL containing it, or a bare id. */
function parseTradeId(input: string): string | null {
  if (!input) return null;
  const m = input.match(/\/t\/([A-Za-z0-9-]{6,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9-]{8,}$/.test(input)) return input;
  return null;
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BUCKETS, BUCKET_BLURB, BUCKET_LABEL } from '@/lib/types';
import type { Bucket, Row } from '@/lib/types';
import DraftRow from './DraftRow';

const EMPTY: Record<Bucket, [string, string]> = {
  people: [
    'Nothing here. Suspiciously virtuous.',
    'Either you message people the moment you find them, or those screenshots are still on your phone.',
  ],
  inspiration: [
    'Empty. Either very disciplined or very offline.',
    'Save something, then come back and we’ll do something with it.',
  ],
  notes: [
    'No notes. Bold.',
    'Photograph the notebook. That counts.',
  ],
};

export default function TableClient({
  active,
  rows,
  countsByBucket,
  undrafted,
}: {
  active: Bucket;
  rows: Row[];
  countsByBucket: Partial<Record<Bucket, number>>;
  undrafted: number;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  async function draftRemaining() {
    setBusy(true);
    for (let pass = 0; pass < 200; pass++) {
      const res = await fetch('/api/draft', { method: 'POST' });
      const data = await res.json();
      if (!data.remaining || data.stalled) break;
    }
    setBusy(false);
    router.refresh();
    flash('Seen to.');
  }

  async function exportAs(destination: 'clipboard' | 'markdown' | 'json' | 'canva') {
    setBusy(true);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: active, destination }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Export failed.');

      if (destination === 'clipboard' || destination === 'canva') {
        await navigator.clipboard.writeText(data.content);
        flash(destination === 'canva' ? 'Copied. Paste it into Canva.' : 'Seen to.');
      } else {
        const blob = new Blob([data.content], {
          type: destination === 'json' ? 'application/json' : 'text/markdown',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename;
        a.click();
        URL.revokeObjectURL(url);
        flash('Seen to.');
      }
      router.refresh();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }

  const drafted = rows.filter((r) => r.draft).length;

  return (
    <>
      {/* ---------------------------------------------------------- tabs */}
      <nav className="flex flex-wrap gap-x-10 gap-y-3 border-b border-rule pb-5">
        {BUCKETS.map((b) => (
          <Link
            key={b}
            href={`/table?bucket=${b}`}
            className={`display text-[clamp(1.8rem,5vw,3rem)] transition-colors ${
              b === active ? 'text-ink' : 'text-rule hover:text-muted'
            }`}
          >
            {BUCKET_LABEL[b]}
            <sup className="ml-2 text-[13px] font-medium tracking-normal align-super tabular-nums">
              {countsByBucket[b] ?? 0}
            </sup>
          </Link>
        ))}
      </nav>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-6">
        <p className="text-[14px] text-muted max-w-[46ch]">{BUCKET_BLURB[active]}</p>

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-6">
            {undrafted > 0 && (
              <button className="btn-quiet" disabled={busy} onClick={draftRemaining}>
                Draft the last {undrafted}
              </button>
            )}
            <button
              className="btn-quiet"
              disabled={busy || !drafted}
              onClick={() => exportAs('clipboard')}
            >
              Copy all
            </button>
            <button
              className="btn-quiet"
              disabled={busy || !drafted}
              onClick={() => exportAs('markdown')}
            >
              .md
            </button>
            <button
              className="btn-quiet"
              disabled={busy || !drafted}
              onClick={() => exportAs('json')}
            >
              .json
            </button>
            <button
              className="btn-quiet"
              disabled={busy || !drafted}
              onClick={() => exportAs('canva')}
            >
              Canva
            </button>
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- table */}
      {rows.length === 0 ? (
        <div className="py-28 max-w-[42ch]">
          <p className="display text-[clamp(1.8rem,4.5vw,2.6rem)] leading-tight">
            {EMPTY[active][0]}
          </p>
          <p className="lede mt-5">{EMPTY[active][1]}</p>
          <Link href="/import" className="btn-solid mt-10">
            Add something
          </Link>
        </div>
      ) : (
        <div className="mt-12 border-t border-rule">
          <div className="hidden md:grid grid-cols-[120px_1fr_1.4fr_150px] gap-6 py-3 border-b border-rule">
            <span className="eyebrow">Saved</span>
            <span className="eyebrow">Source</span>
            <span className="eyebrow">Draft</span>
            <span className="eyebrow text-right">Bucket</span>
          </div>

          {rows.map((row) => (
            <DraftRow key={row.item.id} row={row} onFlash={flash} />
          ))}
        </div>
      )}

      {/* --------------------------------------------------------- toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-ink text-paper px-6 h-12 flex items-center text-[14px] tracking-tight z-50">
          {toast}
        </div>
      )}
    </>
  );
}

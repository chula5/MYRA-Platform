'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BUCKETS, BUCKET_LABEL } from '@/lib/types';
import type { Bucket, Row } from '@/lib/types';

function daysOld(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86_400_000);
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

/** The gentle roast. Scales with how long they've been sitting on it. */
function nag(iso: string | null): string | null {
  const days = daysOld(iso);
  if (days === null) return null;
  if (days >= 365) return 'Over a year ago. Bold of you.';
  if (days >= 120) return `You screenshotted this ${Math.floor(days / 30)} months ago. Bold of you.`;
  if (days >= 60) return `${Math.floor(days / 30)} months. Still relevant, annoyingly.`;
  if (days >= 21) return `${Math.floor(days / 7)} weeks in the pile.`;
  if (days >= 7) return 'Last week. Practically fresh.';
  return null;
}

export default function DraftRow({
  row,
  onFlash,
}: {
  row: Row;
  onFlash: (message: string) => void;
}) {
  const router = useRouter();
  const { item, draft } = row;

  const [text, setText] = useState(draft?.draft_text ?? '');
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, message?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed.');
      if (message) onFlash(message);
      router.refresh();
    } catch (err) {
      onFlash(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    if (draft) {
      await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: item.bucket, destination: 'clipboard' }),
      }).catch(() => {});
    }
    onFlash('Seen to.');
  }

  const line = nag(item.captured_at ?? item.created_at);
  const source = (item.extracted_text ?? '').trim();

  return (
    <article className="grid md:grid-cols-[120px_1fr_1.4fr_150px] gap-4 md:gap-6 py-8 border-b border-rule group">
      {/* --------------------------------------------------------- saved */}
      <div className="min-w-0">
        <p className="text-[13px] tabular-nums">{shortDate(item.captured_at ?? item.created_at)}</p>
        {line && <p className="text-[12px] text-accent mt-1.5 leading-snug">{line}</p>}
        {item.status === 'sent' && (
          <p className="eyebrow mt-2 text-ink">Sent</p>
        )}
      </div>

      {/* -------------------------------------------------------- source */}
      <div className="min-w-0">
        {item.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/image/${item.id}`}
            alt=""
            className="w-full max-w-[160px] border border-rule mb-3"
            loading="lazy"
          />
        )}
        <p
          className={`text-[13px] text-muted leading-relaxed whitespace-pre-wrap ${
            open ? '' : 'line-clamp-4'
          }`}
        >
          {source || 'Nothing legible in this one.'}
        </p>
        {source.length > 220 && (
          <button className="btn-quiet mt-2" onClick={() => setOpen((v) => !v)}>
            {open ? 'Less' : 'More'}
          </button>
        )}
      </div>

      {/* --------------------------------------------------------- draft */}
      <div className="min-w-0">
        {draft || dirty ? (
          <>
            <textarea
              value={text}
              rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
              onChange={(e) => {
                setText(e.target.value);
                setDirty(true);
              }}
              className="w-full bg-transparent text-[14px] leading-relaxed resize-y
                         border border-transparent hover:border-rule focus:border-ink
                         focus:outline-none p-2 -m-2 transition-colors"
            />
            <div className="flex flex-wrap items-center gap-5 mt-3">
              <button className="btn-quiet" disabled={busy} onClick={copy}>
                Send it.
              </button>
              {dirty && (
                <button
                  className="btn-quiet text-accent"
                  disabled={busy}
                  onClick={async () => {
                    await patch({ draft_text: text }, 'Saved. Yours now.');
                    setDirty(false);
                  }}
                >
                  Save edit
                </button>
              )}
              {item.status !== 'sent' && (
                <button
                  className="btn-quiet"
                  disabled={busy}
                  onClick={() => patch({ status: 'sent' }, 'Seen to.')}
                >
                  Mark sent
                </button>
              )}
              <button
                className="btn-quiet"
                disabled={busy}
                onClick={() => patch({ status: 'dismissed' }, 'Gone. No judgement.')}
              >
                Bin it
              </button>
              {draft && draft.version > 1 && (
                <span className="text-[11px] text-muted">v{draft.version}</span>
              )}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted italic">
            Not drafted yet. Use &ldquo;Draft the last N&rdquo; above.
          </p>
        )}
      </div>

      {/* -------------------------------------------------------- bucket */}
      <div className="md:text-right">
        <label className="sr-only" htmlFor={`bucket-${item.id}`}>
          Bucket
        </label>
        <select
          id={`bucket-${item.id}`}
          value={item.bucket ?? ''}
          disabled={busy}
          onChange={(e) =>
            patch({ bucket: e.target.value }, 'Refiled. We’ll redraft on the next pass.')
          }
          className="bg-transparent border border-rule px-3 h-9 text-[13px]
                     hover:border-ink focus:border-ink focus:outline-none transition-colors
                     md:text-right cursor-pointer"
        >
          {BUCKETS.map((b) => (
            <option key={b} value={b}>
              {BUCKET_LABEL[b as Bucket]}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

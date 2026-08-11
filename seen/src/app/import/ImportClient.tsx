'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

type Phase = 'idle' | 'uploading' | 'sorting' | 'drafting' | 'done' | 'error';

interface Progress {
  total: number;
  unsorted: number;
  undrafted: number;
}

const LINES: Record<Phase, string> = {
  idle: '',
  uploading: 'Taking them off your hands.',
  sorting: 'Reading what you saved. Some of this is genuinely good.',
  drafting: 'Writing the things you were going to write.',
  done: 'Seen to.',
  error: 'Something broke.',
};

export default function ImportClient({
  initial,
  instagramConnected,
  hasVoice,
}: {
  initial: Progress;
  instagramConnected: boolean;
  hasVoice: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress>(initial);
  const [detail, setDetail] = useState<string>('');
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Extraction and drafting both loop until the server says nothing is left. */
  async function runPipeline() {
    setPhase('sorting');
    setError(null);

    for (let pass = 0; pass < 200; pass++) {
      const res = await fetch('/api/process', { method: 'POST' });
      const data = await res.json();

      if (data.errors?.length) setDetail(String(data.errors[0]));
      setProgress((p) => ({ ...p, unsorted: data.remaining ?? 0 }));

      if (!data.remaining) break;
      // A pass that sorted nothing will keep sorting nothing.
      if (!data.processed) {
        setError(data.errors?.[0] ?? 'Some images could not be read.');
        break;
      }
    }

    setPhase('drafting');
    setDetail('');

    for (let pass = 0; pass < 200; pass++) {
      const res = await fetch('/api/draft', { method: 'POST' });
      const data = await res.json();

      setProgress((p) => ({ ...p, undrafted: data.remaining ?? 0 }));

      if (data.error) setError(String(data.error));
      if (!data.remaining || data.stalled) break;
    }

    setPhase('done');
    router.refresh();
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;

    setPhase('uploading');
    setError(null);
    setSkipped([]);

    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Upload failed.');

      setSkipped(data.skipped ?? []);
      setProgress((p) => ({
        total: p.total + (data.created ?? 0),
        unsorted: p.unsorted + (data.created ?? 0),
        undrafted: p.undrafted,
      }));

      if (!data.created) {
        setPhase('idle');
        setError('Nothing usable in that batch.');
        return;
      }

      await runPipeline();
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function pullInstagram() {
    setPhase('uploading');
    try {
      const res = await fetch('/api/instagram/import');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Instagram said no.');
      setDetail(`${data.created} of your own posts. Not your saves — those aren't offered.`);
      await runPipeline();
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const working = phase === 'uploading' || phase === 'sorting' || phase === 'drafting';

  return (
    <div className="mt-12">
      {!hasVoice && phase === 'idle' && (
        <p className="text-[13px] text-muted mb-10 border-l-2 border-rule pl-4 max-w-[52ch]">
          You haven&rsquo;t told us how you sound yet, so the drafts will read like a
          competent stranger wrote them.{' '}
          <a href="/voice" className="text-accent underline underline-offset-4">
            Two minutes, one form.
          </a>
        </p>
      )}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        onChange={(e) => onFiles(e.target.files)}
      />

      {/* -------------------------------------------------------- idle */}
      {(phase === 'idle' || phase === 'error') && (
        <>
          <p className="lede max-w-[46ch] mb-12">
            Select the screenshots. All of them. The ones from March too.
          </p>
          <div className="flex flex-wrap items-center gap-8">
            <button className="btn-solid" onClick={() => fileInput.current?.click()}>
              Choose screenshots
            </button>
            {instagramConnected && (
              <button className="btn-quiet" onClick={pullInstagram}>
                Pull my Instagram posts &rarr;
              </button>
            )}
            {progress.total > 0 && (
              <button className="btn-quiet" onClick={() => router.push('/table')}>
                Skip to what&rsquo;s already here &rarr;
              </button>
            )}
          </div>
        </>
      )}

      {/* ----------------------------------------------------- working */}
      {working && (
        <div className="max-w-[46ch]">
          <p className="display text-[clamp(1.6rem,4vw,2.4rem)] leading-tight">
            {LINES[phase]}
          </p>
          <div className="mt-8 h-px bg-rule relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-1/3 bg-accent animate-[slide_1.4s_ease-in-out_infinite]" />
          </div>
          <dl className="mt-8 space-y-2 text-[13px] text-muted">
            <div className="flex justify-between">
              <dt>Left to read</dt>
              <dd className="text-ink tabular-nums">{progress.unsorted}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Left to draft</dt>
              <dd className="text-ink tabular-nums">{progress.undrafted}</dd>
            </div>
          </dl>
          {detail && <p className="mt-6 text-[12px] text-muted">{detail}</p>}
          <style>{`@keyframes slide{0%{left:-33%}100%{left:100%}}`}</style>
        </div>
      )}

      {/* -------------------------------------------------------- done */}
      {phase === 'done' && (
        <div className="max-w-[46ch]">
          <p className="display text-[clamp(2rem,5vw,3rem)] leading-tight">
            You saved {progress.total} things.
            <br />
            <span className="text-accent">Now they&rsquo;re drafts.</span>
          </p>
          <p className="lede mt-6">No further excuses have been provided.</p>
          <button className="btn-solid mt-10" onClick={() => router.push('/table')}>
            Show me
          </button>
        </div>
      )}

      {/* ------------------------------------------------------ errata */}
      {error && (
        <p className="mt-10 text-[13px] text-accent max-w-[52ch]">{error}</p>
      )}

      {skipped.length > 0 && (
        <div className="mt-10 max-w-[52ch]">
          <p className="eyebrow mb-3">Left behind ({skipped.length})</p>
          <ul className="space-y-1.5">
            {skipped.slice(0, 6).map((s) => (
              <li key={s.name} className="text-[13px] text-muted">
                <span className="text-ink">{s.name}</span> &mdash; {s.reason}
              </li>
            ))}
          </ul>
          {skipped.some((s) => /heic/i.test(s.name) || /heic/i.test(s.reason)) && (
            <p className="text-[12px] text-muted mt-3">
              iPhone HEIC files can&rsquo;t be read. Export as JPEG and try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative h-7 w-12 shrink-0 border transition-colors duration-200 ${
        on ? 'bg-accent border-accent' : 'bg-transparent border-rule'
      }`}
    >
      <span
        className={`absolute top-[3px] h-[19px] w-[19px] transition-all duration-200 ${
          on ? 'left-[25px] bg-paper' : 'left-[3px] bg-muted'
        }`}
      />
    </button>
  );
}

export default function ConnectClient({
  photosConnected,
  instagramConnected,
  igStatus,
}: {
  photosConnected: boolean;
  instagramConnected: boolean;
  igStatus: string | null;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState(photosConnected);
  const [busy, setBusy] = useState(false);

  async function togglePhotos() {
    const next = !photos;
    setPhotos(next);
    await fetch('/api/voice', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos: next }),
    });
    router.refresh();
  }

  return (
    <div className="mt-16">
      <ul className="border-t border-rule">
        {/* ------------------------------------------------------ photos */}
        <li className="border-b border-rule py-8 flex items-start gap-6">
          <Toggle on={photos} onClick={togglePhotos} />
          <div className="flex-1 min-w-0">
            <h2 className="text-[20px] font-medium tracking-tight">Photo album</h2>
            <p className="text-[14px] text-muted mt-1.5 max-w-[52ch] leading-relaxed">
              Pick the screenshots straight off your camera roll. Fifty at a time is
              fine. We read them; we don&rsquo;t keep anything you don&rsquo;t import.
            </p>
            {photos && (
              <p className="text-[12px] text-accent mt-3">
                On. The file picker is waiting on the next screen.
              </p>
            )}
          </div>
        </li>

        {/* --------------------------------------------------- instagram */}
        <li className="border-b border-rule py-8 flex items-start gap-6">
          <Toggle
            on={instagramConnected}
            onClick={() => {
              if (instagramConnected) return;
              setBusy(true);
              window.location.href = '/api/instagram/auth';
            }}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-[20px] font-medium tracking-tight">Instagram</h2>
            <p className="text-[14px] text-muted mt-1.5 max-w-[52ch] leading-relaxed">
              Connects your Business or Creator account and pulls your own posts.
            </p>

            <div className="mt-4 border-l-2 border-accent pl-4 max-w-[52ch]">
              <p className="text-[13px] leading-relaxed">
                <span className="font-medium">Your saves aren&rsquo;t available.</span>{' '}
                <span className="text-muted">
                  Instagram doesn&rsquo;t expose saved posts or collections to anyone but
                  Instagram &mdash; there is no endpoint for them, and we&rsquo;re not
                  going to pretend otherwise. Share them to Seen or drop the screenshots
                  in the album instead. It takes about as long.
                </span>
              </p>
            </div>

            {igStatus === 'connected' && (
              <p className="text-[12px] text-accent mt-3">Connected. Modest haul, but fine.</p>
            )}
            {igStatus === 'failed' && (
              <p className="text-[12px] text-accent mt-3">
                That didn&rsquo;t work. Instagram&rsquo;s call, not ours.
              </p>
            )}
            {igStatus === 'unconfigured' && (
              <p className="text-[12px] text-muted mt-3">
                No Instagram app keys in <code className="text-ink">.env.local</code>. The
                album works without them.
              </p>
            )}
          </div>
        </li>
      </ul>

      <div className="mt-12 flex flex-wrap items-center gap-8">
        <button
          className="btn-solid"
          disabled={busy || (!photos && !instagramConnected)}
          onClick={() => router.push('/import')}
        >
          Fine. Connect it.
        </button>
        <button className="btn-quiet" onClick={() => router.push('/voice')}>
          Set your voice first &rarr;
        </button>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { Wordmark } from './components/Chrome';
import { counts, getSettings } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function Landing() {
  const { total, acted } = counts();
  const settings = getSettings();
  const started = Boolean(settings.photos_connected || settings.instagram_connected || total);

  return (
    <main className="min-h-screen flex flex-col">
      <div className="mx-auto w-full max-w-page px-6 pt-10">
        <Wordmark />
      </div>

      <div className="flex-1 mx-auto w-full max-w-page px-6 flex items-center">
        <div className="py-24 md:py-32">
          <p className="eyebrow mb-10">See It Through</p>

          <h1 className="display text-[clamp(3.5rem,13vw,10rem)]">
            Saved
            <br />
            isn&rsquo;t
            <br />
            <span className="text-accent">done.</span>
          </h1>

          <p className="lede mt-12 max-w-[38ch]">
            You have good taste. You screenshot the right people and save the right posts.
            Then you close the app. Seen turns that pile into drafts you can send.
          </p>

          <div className="mt-14 flex flex-wrap items-center gap-8">
            <Link href={started ? '/table' : '/connect'} className="btn-solid">
              {started ? 'Back to it' : 'Start'}
            </Link>
            {total > 0 && (
              <p className="text-[13px] text-muted">
                You saved {total} things. You acted on {acted}.{' '}
                <span className="text-ink">Let&rsquo;s fix that.</span>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-rule">
        <div className="mx-auto max-w-page px-6 py-8 grid gap-8 sm:grid-cols-3">
          {[
            ['People', 'Profiles you screenshotted and never messaged.'],
            ['Inspiration', 'Posts you saved instead of making your own.'],
            ['Notes', 'Thoughts you had once and filed away forever.'],
          ].map(([title, blurb]) => (
            <div key={title}>
              <p className="eyebrow mb-2">{title}</p>
              <p className="text-[14px] text-muted leading-relaxed">{blurb}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

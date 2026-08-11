import { getSettings } from '@/lib/db';
import { Footer, Header } from '../components/Chrome';
import ConnectClient from './ConnectClient';

export const dynamic = 'force-dynamic';

export default function ConnectPage({
  searchParams,
}: {
  searchParams: { ig?: string };
}) {
  const settings = getSettings();

  return (
    <main className="min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 mx-auto w-full max-w-page px-6 py-20">
        <p className="eyebrow mb-6">One screen. Two switches.</p>
        <h1 className="display text-[clamp(2.5rem,7vw,5rem)] max-w-[14ch]">
          Where&rsquo;s the pile?
        </h1>
        <p className="lede mt-8 max-w-[46ch]">
          No account setup. No wizard. Point us at the mess and we&rsquo;ll take it
          from there.
        </p>

        <ConnectClient
          photosConnected={Boolean(settings.photos_connected)}
          instagramConnected={Boolean(settings.instagram_connected)}
          igStatus={searchParams.ig ?? null}
        />
      </div>
      <Footer />
    </main>
  );
}

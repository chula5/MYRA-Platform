import { counts, getSettings } from '@/lib/db';
import { Footer, Header } from '../components/Chrome';
import ImportClient from './ImportClient';

export const dynamic = 'force-dynamic';

export default function ImportPage() {
  const c = counts();
  const settings = getSettings();

  return (
    <main className="min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 mx-auto w-full max-w-page px-6 py-20">
        <p className="eyebrow mb-6">Import &amp; sort</p>
        <h1 className="display text-[clamp(2.5rem,7vw,5rem)] max-w-[13ch]">
          Hand it over.
        </h1>

        <ImportClient
          initial={{ total: c.total, unsorted: c.unsorted, undrafted: c.undrafted }}
          instagramConnected={Boolean(settings.instagram_connected)}
          hasVoice={Boolean(settings.my_business_description || settings.my_offer)}
        />
      </div>
      <Footer />
    </main>
  );
}

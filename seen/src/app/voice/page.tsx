import { getSettings } from '@/lib/db';
import { Footer, Header } from '../components/Chrome';
import VoiceClient from './VoiceClient';

export const dynamic = 'force-dynamic';

export default function VoicePage() {
  const s = getSettings();

  return (
    <main className="min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 mx-auto w-full max-w-page px-6 py-20">
        <p className="eyebrow mb-6">Fill this in once</p>
        <h1 className="display text-[clamp(2.5rem,7vw,5rem)] max-w-[13ch]">
          Sound like you.
        </h1>
        <p className="lede mt-8 max-w-[46ch]">
          Three answers. They go into every draft so the output reads like you wrote it
          on a good day &mdash; not like an assistant guessed.
        </p>

        <VoiceClient
          initial={{
            my_business_description: s.my_business_description,
            my_tone_of_voice: s.my_tone_of_voice,
            my_offer: s.my_offer,
          }}
        />
      </div>
      <Footer />
    </main>
  );
}

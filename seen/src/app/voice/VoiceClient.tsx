'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Voice {
  my_business_description: string;
  my_tone_of_voice: string;
  my_offer: string;
}

const FIELDS: {
  key: keyof Voice;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    key: 'my_business_description',
    label: 'What you do',
    hint: 'Plainly. As if explaining it to someone at a wedding.',
    placeholder:
      'I help independent skincare brands get into department stores. Ten years in wholesale buying, now on the other side of the table.',
  },
  {
    key: 'my_tone_of_voice',
    label: 'How you sound',
    hint: 'Short sentences? Dry? Warm? Write it the way you actually write.',
    placeholder:
      'Direct and dry. Short sentences. I make a claim and back it with a number. No exclamation marks, ever.',
  },
  {
    key: 'my_offer',
    label: 'What you sell',
    hint: 'The specific thing someone can say yes to.',
    placeholder:
      'A six-week retail readiness sprint — pricing, margin model, and a buyer deck. £4,000.',
  },
];

export default function VoiceClient({ initial }: { initial: Voice }) {
  const router = useRouter();
  const [voice, setVoice] = useState<Voice>(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voice),
    });
    setBusy(false);
    setSaved(true);
    router.refresh();
    setTimeout(() => setSaved(false), 2600);
  }

  return (
    <div className="mt-16 max-w-[62ch]">
      <div className="space-y-12">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key} className="block text-[17px] font-medium tracking-tight">
              {f.label}
            </label>
            <p className="text-[13px] text-muted mt-1.5">{f.hint}</p>
            <textarea
              id={f.key}
              rows={3}
              value={voice[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setVoice({ ...voice, [f.key]: e.target.value })}
              className="field mt-4 resize-y leading-relaxed"
            />
          </div>
        ))}
      </div>

      <div className="mt-14 flex flex-wrap items-center gap-8">
        <button className="btn-solid" disabled={busy} onClick={save}>
          {busy ? 'Saving' : 'That’s me'}
        </button>
        <button className="btn-quiet" onClick={() => router.push('/import')}>
          Skip it &rarr;
        </button>
        {saved && <span className="text-[13px] text-accent">Seen to.</span>}
      </div>

      <p className="text-[12px] text-muted mt-14 border-l-2 border-rule pl-4 max-w-[52ch]">
        Leave these blank and the drafts still work &mdash; they just sound like anyone.
      </p>
    </div>
  );
}

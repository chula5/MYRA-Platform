'use client'

// What Alison sees.
//
// A client is not reviewing a queue — she is being shown outfits. So the shoot
// is the whole card and everything else waits behind it: the pieces, the
// prices, the links. The only thing asked of her is whether she would wear it,
// and that question is worth more than everything else on the page, so it sits
// under every look rather than behind a tap.

import { useState } from 'react'
import { reactToLook, type ClientView, type ClientLook } from './actions'

const REASONS = [
  { id: 'not_my_style', label: 'Not my style' },
  { id: 'wrong_occasion', label: 'Wrong for the occasion' },
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'owned_similar', label: 'I have something like it' },
  { id: 'fit_concern', label: 'Not sure it would fit' },
  { id: 'colour', label: 'The colour' },
  { id: 'other', label: 'Something else' },
]

export default function MyLooksClient({ view }: { view: ClientView }) {
  if (!view.memberId) {
    return (
      <p className="text-[17px] leading-relaxed text-[#4A4E57]">
        Your stylist is still setting things up. Nothing to see here just yet.
      </p>
    )
  }

  const byOccasion = new Map<string, ClientLook[]>()
  for (const l of view.looks) {
    byOccasion.set(l.occasion_label, [...(byOccasion.get(l.occasion_label) ?? []), l])
  }

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-[28px] tracking-[0.02em] text-[#0A0A0A]">
          {view.name.split(' ')[0]}, here are your looks
        </h1>
        <p className="text-[17px] leading-relaxed text-[#6B6B6B] mt-2">
          {view.looks.length === 0
            ? 'Nothing here yet — your stylist is working on your first looks.'
            : 'Tell me which you would actually wear. Anything you say changes what comes next.'}
        </p>
      </div>

      {Array.from(byOccasion.entries()).map(([occasion, looks]) => (
        <section key={occasion}>
          <h2 className="text-[15px] tracking-[0.12em] text-[#8B5E00] uppercase mb-5">{occasion}</h2>
          <div className="grid gap-8 sm:grid-cols-2">
            {looks.map((l) => <LookCard key={l.look_id} look={l} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function LookCard({ look }: { look: ClientLook }) {
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<'yes' | 'no' | null>(look.response)
  const [reason, setReason] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function send(v: 'yes' | 'no') {
    setVerdict(v)
    // A no wants a reason; a yes can just be a yes.
    if (v === 'no' && !reason) return
    setSaving(true)
    const r = await reactToLook(look.look_id, v, reason, words)
    setSaving(false)
    if (!r.error) setSaved(true)
  }

  const total = look.items.reduce((n, i) => n + (i.owned ? 0 : (i.price_gbp ?? 0)), 0)

  return (
    <div>
      {look.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={look.image_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#F3F2EF]" />
      ) : (
        <div className="w-full aspect-[3/4] bg-[#F3F2EF]" />
      )}

      <button onClick={() => setOpen((v) => !v)} className="mt-3 text-[15px] text-[#4A4E57] underline underline-offset-4">
        {open ? 'Hide the pieces' : `See the ${look.items.length} pieces`}
        {total > 0 && <span className="text-[#A8A8A4] no-underline"> · £{Math.round(total)}</span>}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {look.items.map((it, i) => (
            <div key={i} className="flex items-center gap-3">
              {it.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.image_url} alt="" className="w-14 aspect-[3/4] object-cover shrink-0 bg-[#F3F2EF]" />
              )}
              <div className="min-w-0">
                <p className="text-[13px] tracking-[0.08em] text-[#A8A8A4] uppercase truncate">
                  {it.brand}{it.item_type && ` · ${it.item_type.replace(/_/g, ' ')}`}
                </p>
                <p className="text-[16px] text-[#0A0A0A] truncate">
                  {it.owned && <span className="text-[#8B5E00]">Yours · </span>}
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      {it.product_name}
                    </a>
                  ) : it.product_name}
                  {!it.owned && typeof it.price_gbp === 'number' && <span className="text-[#6B6B6B]"> £{Math.round(it.price_gbp)}</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The question. Never behind a tap — it is the only thing being asked. */}
      <div className="mt-5 border-t border-[#E2E0DB] pt-4">
        {saved || (look.response && !verdict) ? (
          <p className="text-[16px] text-[#3D7A50]">Thank you — noted.</p>
        ) : (
          <>
            <div className="flex gap-3">
              <button
                onClick={() => send('yes')}
                disabled={saving}
                className={`text-[16px] px-5 py-2.5 border transition-colors ${verdict === 'yes' ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'border-[#0A0A0A] text-[#0A0A0A] hover:bg-[#F3F2EF]'}`}
              >
                I would wear this
              </button>
              <button
                onClick={() => setVerdict('no')}
                disabled={saving}
                className={`text-[16px] px-5 py-2.5 border transition-colors ${verdict === 'no' ? 'bg-[#4A4E57] text-white border-[#4A4E57]' : 'border-[#C8C6C1] text-[#6B6B6B] hover:border-[#4A4E57]'}`}
              >
                Not for me
              </button>
            </div>

            {verdict === 'no' && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {REASONS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setReason(r.id)}
                      className={`text-[14px] px-3 py-1.5 border transition-colors ${reason === r.id ? 'border-[#0A0A0A] text-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B]'}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  placeholder="In your own words — this is the most useful part"
                  rows={2}
                  className="w-full text-[16px] border border-[#E2E0DB] px-3 py-2 outline-none focus:border-[#0A0A0A]"
                />
                <button
                  onClick={() => send('no')}
                  disabled={saving || !reason}
                  className="text-[16px] px-5 py-2.5 bg-[#0A0A0A] text-white disabled:opacity-40"
                >
                  {saving ? 'Sending…' : 'Send'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

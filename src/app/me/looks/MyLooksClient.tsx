'use client'

// WHAT ALISON SEES.
//
// Built to read like the feed rather than like an admin queue, because that is
// what it is for her: MYRA at the top, a search, outfit cards on a grey
// photographic ground. The pieces sit behind the look, and the only question
// asked of her — would you wear this — sits under every card rather than
// behind a tap, because it is the one thing the whole pilot is for.
//
// Three sections, in the order she cares about them: what is waiting for her
// answer, what she has already loved, and a way to ask for something new.

import { useMemo, useState } from 'react'
import { reactToLook, requestLooks, type ClientView, type ClientLook } from './actions'
import { CLIENT_OCCASIONS, CLIENT_CLIMATES } from '@/lib/client-occasions'

const REASONS = [
  { id: 'not_my_style', label: 'Not my style' },
  { id: 'wrong_occasion', label: 'Wrong for the occasion' },
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'owned_similar', label: 'I have something like it' },
  { id: 'fit_concern', label: 'Not sure it would fit' },
  { id: 'colour', label: 'The colour' },
  { id: 'other', label: 'Something else' },
]

export default function MyLooksClient({ view, readOnly = false }: { view: ClientView; readOnly?: boolean }) {
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [occasion, setOccasion] = useState('')
  const [styling, setStyling] = useState<ClientLook | null>(null)
  const [exploring, setExploring] = useState<ClientLook | null>(null)

  const brands = useMemo(() => {
    const s = new Set<string>()
    for (const l of view.looks) for (const it of l.items) if (it.brand) s.add(it.brand)
    return Array.from(s).sort()
  }, [view.looks])

  const occasions = useMemo(
    () => Array.from(new Set(view.looks.map((l) => l.occasion_label))),
    [view.looks],
  )

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase()
    return view.looks.filter((l) => {
      if (occasion && l.occasion_label !== occasion) return false
      if (brand && !l.items.some((i) => i.brand === brand)) return false
      if (!q) return true
      const hay = [l.occasion_label, ...l.items.map((i) => `${i.brand} ${i.product_name} ${i.item_type ?? ''}`)]
        .join(' ').toLowerCase()
      return q.split(/\s+/).every((t) => hay.includes(t))
    })
  }, [view.looks, query, brand, occasion])

  const waiting = matching.filter((l) => !l.response)
  const loved = matching.filter((l) => l.response === 'yes')

  if (!view.memberId) {
    return <p className="text-[17px] text-[#4A4E57]">Your stylist is still setting things up.</p>
  }

  return (
    <div className="-mx-5 -my-10 bg-[#D8D5D0] min-h-screen">
      <div className="max-w-[1200px] mx-auto px-5 py-10">
        <header className="text-center mb-8">
          <p className="text-[22px] tracking-[0.34em] text-[#2B2B2B]">MYRA</p>
          <p className="text-[15px] tracking-[0.04em] text-[#55534E] mt-2">
            {view.name.split(' ')[0]}, styled for you
          </p>
        </header>

        {/* Search and filters, the way the feed does it. */}
        <div className="max-w-[720px] mx-auto mb-6">
          <div className="flex items-center border border-[#2B2B2B] bg-transparent">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your looks — a brand, a colour, a piece"
              className="flex-1 min-w-0 bg-transparent border-0 px-5 py-3.5 text-[16px] placeholder:text-[#6E6B65] focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="px-4 text-[15px] text-[#55534E]">clear</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            {occasions.map((o) => (
              <button
                key={o}
                onClick={() => setOccasion(occasion === o ? '' : o)}
                className={`text-[14px] px-3.5 py-1.5 border transition-colors ${occasion === o ? 'border-[#2B2B2B] bg-[#2B2B2B] text-white' : 'border-[#9B978F] text-[#40403C] hover:border-[#2B2B2B]'}`}
              >
                {o}
              </button>
            ))}
            {brands.length > 1 && (
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="text-[14px] px-3 py-1.5 border border-[#9B978F] bg-transparent text-[#40403C]"
              >
                <option value="">Any brand</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
        </div>

        {!readOnly && <AskPanel />}

        {waiting.length > 0 && (
          <Section title="Waiting for you" subtitle="Tell me which you would actually wear">
            {waiting.map((l) => (
              <LookCard key={l.look_id} look={l} readOnly={readOnly}
                onStyleThis={() => setStyling(l)} onExplore={() => setExploring(l)} />
            ))}
          </Section>
        )}

        {loved.length > 0 && (
          <Section title="Looks you loved" subtitle="Kept, and shaping what comes next">
            {loved.map((l) => (
              <LookCard key={l.look_id} look={l} readOnly={readOnly}
                onStyleThis={() => setStyling(l)} onExplore={() => setExploring(l)} />
            ))}
          </Section>
        )}

        {/* STYLE ITEMS — she picks a piece and asks for it worn another way.
            EXPLORE STYLES — more like this one. Both are the same request in
            the end: her stylist composes and checks before it lands here. */}
        {styling && (
          <RequestModal
            title={`Which piece would you like styled another way?`}
            look={styling}
            onClose={() => setStyling(null)}
          />
        )}
        {exploring && (
          <RequestModal
            title="More like this one?"
            look={exploring}
            exploring
            onClose={() => setExploring(null)}
          />
        )}

        {matching.length === 0 && (
          <p className="text-center text-[16px] text-[#55534E] py-12">
            {view.looks.length ? 'Nothing matches that.' : 'Your first looks are on their way.'}
          </p>
        )}
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="text-center mb-5">
        <h2 className="text-[19px] tracking-[0.04em] text-[#2B2B2B]">{title}</h2>
        <p className="text-[14px] text-[#6E6B65] mt-1">{subtitle}</p>
      </div>
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  )
}

/** Ask for something. Occasions as buttons, because a blank box asks her to do
 *  the work of knowing what to type. */
function AskPanel() {
  const [open, setOpen] = useState(false)
  const [occasion, setOccasion] = useState('')
  const [climate, setClimate] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  if (sent) {
    return (
      <div className="max-w-[720px] mx-auto mb-10 border border-[#2B2B2B] px-5 py-4 text-center">
        <p className="text-[16px] text-[#2B2B2B]">
          MYRA is putting some looks together for you. Your stylist checks them before they land here.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-[720px] mx-auto mb-10">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full border border-[#2B2B2B] px-5 py-3.5 text-[16px] text-[#2B2B2B] hover:bg-[rgba(255,255,255,0.25)] transition-colors"
        >
          Ask for something new
        </button>
      ) : (
        <div className="border border-[#2B2B2B] px-5 py-5 space-y-4">
          <p className="text-[16px] text-[#2B2B2B]">What is it for?</p>
          <div className="flex flex-wrap gap-2">
            {CLIENT_OCCASIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOccasion(o.id)}
                className={`text-[15px] px-3.5 py-2 border transition-colors ${occasion === o.id ? 'border-[#2B2B2B] bg-[#2B2B2B] text-white' : 'border-[#9B978F] text-[#40403C]'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {CLIENT_CLIMATES.map((c) => (
              <button
                key={c.id}
                onClick={() => setClimate(climate === c.id ? null : c.id)}
                className={`text-[14px] px-3 py-1.5 border transition-colors ${climate === c.id ? 'border-[#2B2B2B] bg-[#2B2B2B] text-white' : 'border-[#9B978F] text-[#40403C]'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <textarea
            value={words}
            onChange={(e) => setWords(e.target.value)}
            rows={2}
            placeholder="Anything else I should know — where you are going, what you feel like"
            className="w-full text-[16px] bg-transparent border border-[#9B978F] px-3 py-2 focus:outline-none focus:border-[#2B2B2B]"
          />
          <div className="flex gap-3">
            <button
              disabled={!occasion || busy}
              onClick={async () => {
                setBusy(true)
                const r = await requestLooks(occasion, climate, words)
                setBusy(false)
                if (!r.error) setSent(true)
              }}
              className="text-[16px] px-5 py-2.5 bg-[#2B2B2B] text-white disabled:opacity-40"
            >
              {busy ? 'Sending…' : 'Ask MYRA'}
            </button>
            <button onClick={() => setOpen(false)} className="text-[16px] px-5 py-2.5 border border-[#9B978F] text-[#40403C]">
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** She asks for a piece styled again, or for more like a look she has. Both
 *  go the same way: composed on request, checked, then sent. */
function RequestModal({
  title, look, exploring, onClose,
}: {
  title: string
  look: ClientLook
  exploring?: boolean
  onClose: () => void
}) {
  const [picked, setPicked] = useState<string | null>(exploring ? 'all' : null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const ask = async () => {
    setBusy(true)
    const piece = look.items.find((i) => i.item_id === picked)
    const words = exploring
      ? `More looks like the one with the ${look.items[0]?.product_name ?? 'pieces'} — ${look.occasion_label}`
      : `Style my ${piece?.product_name ?? 'piece'} another way`
    await requestLooks(look.occasion_id ?? 'casual_day', null, words)
    setBusy(false)
    setSent(true)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#EDEBE7] max-w-[520px] w-full p-6" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <>
            <p className="text-[17px] text-[#2B2B2B]">
              MYRA is working on it. Your stylist checks the looks before they land here.
            </p>
            <button onClick={onClose} className="mt-5 text-[16px] px-5 py-2.5 bg-[#2B2B2B] text-white">Close</button>
          </>
        ) : (
          <>
            <p className="text-[17px] text-[#2B2B2B] mb-4">{title}</p>
            {!exploring && (
              <div className="space-y-2 mb-5 max-h-[45vh] overflow-y-auto">
                {look.items.filter((i) => i.item_id).map((it) => (
                  <button
                    key={it.item_id}
                    onClick={() => setPicked(it.item_id)}
                    className={`w-full flex items-center gap-3 p-2 border text-left transition-colors ${picked === it.item_id ? 'border-[#2B2B2B]' : 'border-[#C3BFB8]'}`}
                  >
                    {it.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.image_url} alt="" className="w-12 aspect-[3/4] object-cover shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-[11px] tracking-[0.09em] text-[#6E6B65] uppercase truncate">{it.brand}</span>
                      <span className="block text-[15px] text-[#2B2B2B] truncate">{it.product_name}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button
                disabled={!picked || busy}
                onClick={ask}
                className="text-[16px] px-5 py-2.5 bg-[#2B2B2B] text-white disabled:opacity-40"
              >
                {busy ? 'Asking…' : 'Ask MYRA'}
              </button>
              <button onClick={onClose} className="text-[16px] px-5 py-2.5 border border-[#9B978F] text-[#40403C]">
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Same treatment as the feed's cards: white, uppercase, tracked, over a
// gradient — the actions belong to the photograph, not to a toolbar.
const ACTION = 'pointer-events-auto text-white text-[11px] tracking-[0.1em] uppercase font-light hover:opacity-70 transition-opacity'

function LookCard({
  look, readOnly, onStyleThis, onExplore,
}: {
  look: ClientLook
  readOnly?: boolean
  onStyleThis?: (l: ClientLook) => void
  onExplore?: (l: ClientLook) => void
}) {
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<'yes' | 'no' | null>(look.response)
  const [reason, setReason] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function send(v: 'yes' | 'no') {
    setVerdict(v)
    if (v === 'no' && !reason) return
    setSaving(true)
    const r = await reactToLook(look.look_id, v, reason, words)
    setSaving(false)
    if (!r.error) setSaved(true)
  }

  const total = look.items.reduce((n, i) => n + (i.owned ? 0 : (i.price_gbp ?? 0)), 0)

  return (
    <div className="bg-[#EDEBE7] border border-[#C3BFB8]">
      {/* The photo carries the actions, the way the feed does it: white text
          over a gradient rather than a row of admin buttons underneath. */}
      <div className="relative group">
        {look.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={look.image_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#EDEDED]" />
        ) : (
          <div className="w-full aspect-[3/4] bg-[#EDEDED]" />
        )}

        {/* Shop-the-look panel, overlaid when she asks to source the pieces. */}
        {open && look.items.length > 0 && (
          <div className="absolute inset-0 z-30 bg-black/45 overflow-y-auto p-3">
            <div className="space-y-2">
              {look.items.map((it, i) => (
                <div key={i} className="flex items-center gap-3 bg-white/95 p-2">
                  {it.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image_url} alt="" className="w-12 aspect-[3/4] object-cover shrink-0 bg-[#E3E1DD]" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] tracking-[0.09em] text-[#6E6B65] uppercase truncate">
                      {it.brand}{it.item_type && ` · ${it.item_type.replace(/_/g, ' ')}`}
                    </p>
                    <p className="text-[14px] text-[#2B2B2B] truncate">
                      {it.owned && <span className="text-[#8B5E00]">Yours · </span>}
                      {it.product_name}
                      {!it.owned && typeof it.price_gbp === 'number' && <span className="text-[#55534E]"> £{Math.round(it.price_gbp)}</span>}
                    </p>
                    {it.url && !it.owned && (
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] tracking-[0.09em] uppercase text-[#2B2B2B] underline underline-offset-2"
                      >
                        Shop it
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 z-40 pt-10 pb-3.5 px-3 bg-gradient-to-t from-black/55 via-black/20 to-transparent pointer-events-none">
          <div className="flex items-center justify-center gap-x-4">
            <button onClick={() => setOpen((v) => !v)} className={ACTION}>
              {open ? 'Hide Items' : 'Source Items'}
            </button>
            <button onClick={() => onStyleThis?.(look)} className={ACTION}>Style Items</button>
          </div>
          <div className="flex justify-center mt-1.5">
            <button onClick={() => onExplore?.(look)} className={ACTION}>Explore Styles</button>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {total > 0 && (
          <p className="text-[14px] text-[#6E6B65]">
            {look.items.length} pieces · £{Math.round(total)}
          </p>
        )}

        <div className="mt-4 border-t border-[#C3BFB8] pt-4">
          {readOnly ? (
            <p className="text-[14px] text-[#6E6B65]">
              {look.response === 'yes' ? 'She said she would wear this'
                : look.response === 'no' ? 'She said not for her'
                : 'She has not answered yet'}
            </p>
          ) : saved || (look.response && !verdict) ? (
            <p className="text-[15px] text-[#3D6B45]">
              {(saved ? verdict : look.response) === 'yes' ? 'Loved — noted.' : 'Noted, thank you.'}
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => send('yes')}
                  disabled={saving}
                  className={`text-[15px] px-4 py-2 border transition-colors ${verdict === 'yes' ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'border-[#2B2B2B] text-[#2B2B2B] hover:bg-[rgba(255,255,255,0.35)]'}`}
                >
                  I would wear this
                </button>
                <button
                  onClick={() => setVerdict('no')}
                  disabled={saving}
                  className={`text-[15px] px-4 py-2 border transition-colors ${verdict === 'no' ? 'bg-[#55534E] text-white border-[#55534E]' : 'border-[#9B978F] text-[#55534E]'}`}
                >
                  Not for me
                </button>
              </div>

              {verdict === 'no' && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {REASONS.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setReason(r.id)}
                        className={`text-[13px] px-2.5 py-1 border transition-colors ${reason === r.id ? 'border-[#2B2B2B] text-[#2B2B2B]' : 'border-[#C3BFB8] text-[#6E6B65]'}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={words}
                    onChange={(e) => setWords(e.target.value)}
                    rows={2}
                    placeholder="In your own words — the most useful part"
                    className="w-full text-[15px] bg-transparent border border-[#C3BFB8] px-2.5 py-2 focus:outline-none focus:border-[#2B2B2B]"
                  />
                  <button
                    onClick={() => send('no')}
                    disabled={saving || !reason}
                    className="text-[15px] px-4 py-2 bg-[#2B2B2B] text-white disabled:opacity-40"
                  >
                    {saving ? 'Sending…' : 'Send'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

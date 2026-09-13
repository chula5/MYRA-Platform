'use client'

// ALISON'S PAGE.
//
// Built to mirror the feed she already knows rather than to be a new thing:
// MYRA at the top, a search, the occasion grid with each name in white over a
// live look, and the same white actions over every card. What differs is only
// what it is made of — her looks, her verdicts, her stylist — not how it
// behaves.
//
// Less on screen at rest. The page opens on occasions and what she has loved;
// the grid of everything is one tap inside an occasion, the way the feed does
// it. Explore Styles searches her own looks rather than composing, because a
// client browsing should not have to wait for a stylist.

import { useEffect, useMemo, useState } from 'react'
import ClientWardrobe from './ClientWardrobe'
import { toggleSaveItem } from '@/app/edit/save-actions'
import { reactToLook, requestLooks, type ClientView, type ClientLook } from './actions'
import { CLIENT_OCCASIONS, CLIENT_CLIMATES } from '@/lib/client-occasions'
import { lookSimilarity, mostSimilar } from '@/lib/look-similarity'

const REASONS = [
  { id: 'not_my_style', label: 'Not my style' },
  { id: 'wrong_occasion', label: 'Wrong for the occasion' },
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'owned_similar', label: 'I have something like it' },
  { id: 'fit_concern', label: 'Not sure it would fit' },
  { id: 'colour', label: 'The colour' },
  { id: 'other', label: 'Something else' },
]

const RECENT_KEY = 'myra:me:recent'

const ACTION = 'pointer-events-auto text-white text-[11px] tracking-[0.1em] uppercase font-light hover:opacity-70 transition-opacity'

export default function MyLooksClient({ view, readOnly = false }: { view: ClientView; readOnly?: boolean }) {
  const [query, setQuery] = useState('')
  const [occasion, setOccasion] = useState<string | null>(null)
  const [exploring, setExploring] = useState<ClientLook | null>(null)
  const [styling, setStyling] = useState<ClientLook | null>(null)
  const [asking, setAsking] = useState(false)
  const [recent, setRecent] = useState<string[]>([])

  // Recently viewed, kept in her browser the way the feed kept it — a trail of
  // what she opened, not a judgement about it.
  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')) } catch { /* fine */ }
  }, [])
  function noteViewed(id: string) {
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* fine */ }
      return next
    })
  }

  // Everything she browses excludes what she has already turned down. A look
  // she said no to still counts for the learning; it just stops being offered
  // back to her in a grid, a search or an Explore row.
  const browsable = useMemo(() => view.looks.filter((l) => l.response !== 'no'), [view.looks])

  const occasions = useMemo(() => {
    const m = new Map<string, ClientLook[]>()
    for (const l of browsable) m.set(l.occasion_label, [...(m.get(l.occasion_label) ?? []), l])
    return Array.from(m.entries())
  }, [browsable])

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return browsable.filter((l) => {
      const hay = [l.occasion_label, ...l.items.map((i) => `${i.brand} ${i.product_name} ${i.item_type ?? ''}`)]
        .join(' ').toLowerCase()
      return q.split(/\s+/).every((t) => hay.includes(t))
    })
  }, [browsable, query])

  const loved = view.looks.filter((l) => l.response === 'yes')
  const waiting = view.looks.filter((l) => !l.response)

  const similar = useMemo(() => {
    if (!exploring) return []
    return mostSimilar(exploring, browsable, 6)
  }, [exploring, browsable])

  // Because you loved … — her unanswered looks ranked by likeness to what she
  // has already said yes to. Same similarity as Explore, different question.
  const becauseYouLoved = useMemo(() => {
    if (!loved.length) return []
    return browsable
      // Unanswered only. `!== 'yes'` let looks she had already turned down come
      // back recommended, which is worse than showing her nothing.
      .filter((l) => !l.response)
      .map((l) => ({ l, s: Math.max(...loved.map((k) => lookSimilarity(k, l))) }))
      .filter((x) => x.s > 0.1)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => x.l)
  }, [browsable, loved])

  const recentLooks = useMemo(
    () => recent.map((id) => browsable.find((l) => l.look_id === id)).filter(Boolean) as ClientLook[],
    [recent, browsable],
  )

  if (!view.memberId) {
    return <p className="text-[17px] text-[#4A4E57]">Your stylist is still setting things up.</p>
  }

  const cardProps = (l: ClientLook) => ({
    look: l, readOnly,
    onExplore: () => { noteViewed(l.look_id); setExploring(l); setOccasion(null); setQuery('') },
    onOpen: () => noteViewed(l.look_id),
    onStyleThis: () => setStyling(l),
  })

  return (
    <div className="-mx-5 -my-10 bg-[#D8D5D0] min-h-screen">
      <ClientWardrobe readOnly={readOnly} loved={loved} onOpenLook={(l) => { setExploring(null); setQuery(''); setOccasion(l.occasion_label) }} />

      <div className="max-w-[1100px] mx-auto px-5 py-10">
        <header className="text-center mb-7">
          <p className="text-[22px] tracking-[0.34em] text-[#2B2B2B]">MYRA</p>
          <p className="text-[15px] tracking-[0.04em] text-[#55534E] mt-2">
            {view.name.split(' ')[0]}, styled for you
          </p>
        </header>

        <div className="max-w-[680px] mx-auto mb-8">
          <div className="flex items-center border border-[#2B2B2B]">
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOccasion(null); setExploring(null) }}
              placeholder="Search your looks"
              className="flex-1 min-w-0 bg-transparent border-0 px-5 py-3.5 text-[16px] placeholder:text-[#6E6B65] focus:outline-none"
            />
            {query && <button onClick={() => setQuery('')} className="px-4 text-[15px] text-[#55534E]">clear</button>}
          </div>
        </div>

        {/* ── Explore results ─────────────────────────────────────────────── */}
        {exploring && (
          <Results
            label="More like this one"
            note={`${similar.length} of your looks`}
            onBack={() => setExploring(null)}
            looks={similar}
            cardProps={cardProps}
          />
        )}

        {/* ── Search results ──────────────────────────────────────────────── */}
        {!exploring && searched && (
          <Results
            label={`“${query}”`}
            note={`${searched.length} look${searched.length === 1 ? '' : 's'}`}
            onBack={() => setQuery('')}
            looks={searched}
            cardProps={cardProps}
          />
        )}

        {/* ── One occasion, opened ────────────────────────────────────────── */}
        {!exploring && !searched && occasion && (
          <Results
            label={occasion}
            note={`${occasions.find(([o]) => o === occasion)?.[1].length ?? 0} looks`}
            onBack={() => setOccasion(null)}
            looks={occasions.find(([o]) => o === occasion)?.[1] ?? []}
            cardProps={cardProps}
          />
        )}

        {/* ── At rest ─────────────────────────────────────────────────────── */}
        {!exploring && !searched && !occasion && (
          <>
            {waiting.length > 0 && (
              <section className="mb-10">
                <p className="text-[13px] tracking-[0.14em] text-[#55534E] uppercase text-center mb-1">
                  Waiting for you
                </p>
                <p className="text-[14px] text-[#6E6B65] text-center mb-4">
                  {waiting.length} look{waiting.length === 1 ? '' : 's'} to tell me about
                </p>
                <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {waiting.slice(0, 3).map((l) => <LookCard key={l.look_id} {...cardProps(l)} />)}
                </div>
              </section>
            )}

            {/* The occasion grid — the feed's contact sheet, each name in white
                over one of her own looks. */}
            {occasions.length > 0 && (
              <section className="mb-10">
                <p className="text-[13px] tracking-[0.14em] text-[#55534E] uppercase text-center mb-4">
                  Recommended for you
                </p>
                <div className="grid grid-cols-3 gap-[6px]">
                  {occasions.slice(0, 6).map(([label, looks]) => (
                    <button
                      key={label}
                      onClick={() => setOccasion(label)}
                      className="group relative w-full aspect-[3/4] overflow-hidden bg-[#E4E2DD]"
                    >
                      {looks[0]?.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={looks[0].image_url}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 group-hover:opacity-85"
                        />
                      )}
                      <span className="absolute inset-0 bg-[rgba(0,0,0,0.18)]" aria-hidden />
                      <span className="absolute inset-0 flex items-center justify-center px-3 md:px-6 text-center text-white text-[19px] md:text-[30px] tracking-[0.14em] leading-[1.2] drop-shadow-[0_1px_8px_rgba(0,0,0,0.5)]">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {becauseYouLoved.length > 0 && (
              <section className="mb-10">
                <p className="text-[13px] tracking-[0.14em] text-[#55534E] uppercase text-center mb-1">
                  Because you loved
                </p>
                <p className="text-[14px] text-[#6E6B65] text-center mb-4">
                  Built from pieces and labels you have already said yes to
                </p>
                <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {becauseYouLoved.map((l) => <LookCard key={l.look_id} {...cardProps(l)} />)}
                </div>
              </section>
            )}

            {recentLooks.length > 0 && (
              <section className="mb-10">
                <p className="text-[13px] tracking-[0.14em] text-[#55534E] uppercase text-center mb-4">
                  Recently viewed
                </p>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-[6px]">
                  {recentLooks.map((l) => (
                    <button
                      key={l.look_id}
                      onClick={() => setExploring(l)}
                      className="relative w-full aspect-[3/4] overflow-hidden bg-[#E4E2DD]"
                    >
                      {l.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.image_url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {loved.length > 0 && (
              <section className="mb-10">
                <p className="text-[13px] tracking-[0.14em] text-[#55534E] uppercase text-center mb-1">
                  <span className="text-[#C8302A]" aria-hidden>♥ </span>Looks you loved
                </p>
                <p className="text-[14px] text-[#6E6B65] text-center mb-4">Shaping what comes next</p>
                <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {loved.slice(0, 6).map((l) => <LookCard key={l.look_id} {...cardProps(l)} />)}
                </div>
              </section>
            )}

            {!readOnly && (
              <div className="max-w-[680px] mx-auto">
                {asking ? (
                  <AskPanel onDone={() => setAsking(false)} />
                ) : (
                  <button
                    onClick={() => setAsking(true)}
                    className="w-full border border-[#2B2B2B] px-5 py-3.5 text-[16px] text-[#2B2B2B] hover:bg-[rgba(255,255,255,0.25)] transition-colors"
                  >
                    Ask for something new
                  </button>
                )}
              </div>
            )}

            {view.looks.length === 0 && (
              <p className="text-center text-[16px] text-[#55534E] py-12">
                Your first looks are on their way.
              </p>
            )}
          </>
        )}

        {styling && <StyleItemModal look={styling} onClose={() => setStyling(null)} />}
      </div>
    </div>
  )
}

function Results({
  label, note, onBack, looks, cardProps,
}: {
  label: string
  note: string
  onBack: () => void
  looks: ClientLook[]
  cardProps: (l: ClientLook) => Record<string, unknown>
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <p className="text-[19px] tracking-[0.04em] text-[#2B2B2B]">{label}</p>
          <p className="text-[14px] text-[#6E6B65] mt-0.5">{note}</p>
        </div>
        <button onClick={onBack} className="text-[15px] text-[#40403C] underline underline-offset-4">Back</button>
      </div>
      {looks.length === 0 ? (
        <p className="text-center text-[16px] text-[#55534E] py-10">Nothing here yet.</p>
      ) : (
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {looks.map((l) => <LookCard key={l.look_id} {...(cardProps(l) as any)} />)}
        </div>
      )}
    </section>
  )
}

function LookCard({
  look, readOnly, onStyleThis, onExplore, onOpen,
}: {
  look: ClientLook
  readOnly?: boolean
  onStyleThis?: () => void
  onExplore?: () => void
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [verdict, setVerdict] = useState<'yes' | 'no' | null>(look.response)
  const [reason, setReason] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hung, setHung] = useState<Set<string>>(new Set())

  async function hangUp(itemId: string) {
    setHung((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId)
      return next
    })
    await toggleSaveItem(itemId)
    window.dispatchEvent(new Event('myra:item-saved'))
  }

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
      <div className="relative group">
        {look.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={look.image_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#EDEDED]" />
        ) : (
          <div className="w-full aspect-[3/4] bg-[#EDEDED]" />
        )}

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
                      <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-[12px] tracking-[0.09em] uppercase text-[#2B2B2B] underline underline-offset-2">
                        Shop it
                      </a>
                    )}
                  </div>
                  {!readOnly && it.item_id && (
                    <button
                      onClick={() => hangUp(it.item_id as string)}
                      aria-label="Save to my wardrobe"
                      className={`ml-auto shrink-0 text-[17px] leading-none ${hung.has(it.item_id) ? 'text-[#C8302A]' : 'text-[#B4B0A9] hover:text-[#C8302A]'}`}
                    >
                      ♥
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 z-40 pt-10 pb-3.5 px-3 bg-gradient-to-t from-black/55 via-black/20 to-transparent pointer-events-none">
          <div className="flex items-center justify-center gap-x-4">
            <button onClick={() => { if (!open) onOpen?.(); setOpen((v) => !v) }} className={ACTION}>
              {open ? 'Hide Items' : 'Source Items'}
            </button>
            {!readOnly && <button onClick={onStyleThis} className={ACTION}>Style Items</button>}
          </div>
          <div className="flex justify-center mt-1.5">
            <button onClick={onExplore} className={ACTION}>Explore Styles</button>
          </div>
        </div>
      </div>

      <div className="px-4 py-3.5">
        {total > 0 && (
          <p className="text-[13px] text-[#6E6B65] mb-2">{look.items.length} pieces · £{Math.round(total)}</p>
        )}
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
  )
}

/** One piece, worn another way. Composed on request — the one thing here that
 *  cannot be answered from what she already has. */
function StyleItemModal({ look, onClose }: { look: ClientLook; onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

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
            <p className="text-[17px] text-[#2B2B2B] mb-4">Which piece would you like styled another way?</p>
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
            <div className="flex gap-3">
              <button
                disabled={!picked || busy}
                onClick={async () => {
                  setBusy(true)
                  const piece = look.items.find((i) => i.item_id === picked)
                  await requestLooks(look.occasion_id ?? 'casual_day', null, `Style my ${piece?.product_name ?? 'piece'} another way`)
                  setBusy(false)
                  setSent(true)
                }}
                className="text-[16px] px-5 py-2.5 bg-[#2B2B2B] text-white disabled:opacity-40"
              >
                {busy ? 'Asking…' : 'Ask MYRA'}
              </button>
              <button onClick={onClose} className="text-[16px] px-5 py-2.5 border border-[#9B978F] text-[#40403C]">Not now</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AskPanel({ onDone }: { onDone: () => void }) {
  const [occasion, setOccasion] = useState('')
  const [climate, setClimate] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  if (sent) {
    return (
      <div className="border border-[#2B2B2B] px-5 py-4 text-center">
        <p className="text-[16px] text-[#2B2B2B]">
          MYRA is putting some looks together. Your stylist checks them before they land here.
        </p>
      </div>
    )
  }

  return (
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
        placeholder="Anything else I should know"
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
        <button onClick={onDone} className="text-[16px] px-5 py-2.5 border border-[#9B978F] text-[#40403C]">Not now</button>
      </div>
    </div>
  )
}

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

import { useEffect, useMemo, useRef, useState } from 'react'
import ClientWardrobe from './ClientWardrobe'
import { reactToLook, requestLooks, type ClientView, type ClientLook, type ClientLookItem } from './actions'
import { CLIENT_OCCASIONS, CLIENT_CLIMATES } from '@/lib/client-occasions'
import { lookSimilarity, relatedLooks, looksWearing } from '@/lib/look-similarity'
import FallbackImage from '@/components/FallbackImage'
import Hotspot from '@/components/hotspot/Hotspot'
import ShopTheLookOverlay from '@/components/source-panel/ShopTheLookOverlay'
import { getSavedItemIds, toggleSaveItem } from '@/app/edit/save-actions'
import type { Item, Brand, ItemType } from '@/types/database'
import { ArchiveCard } from '@/components/ArchiveCard'
import { previewAskForMember, rescoreAskLook, type AskPreviewResult } from '@/app/admin/private-stylist/confidence-actions'
import { keepAskPreview, askPreviewAlternates } from '@/app/admin/private-stylist/actions.gated'
import type { AskSwapOption, AskLookEdits } from '@/app/admin/private-stylist/actions'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'

// The feed's section heading pair, so her page reads at the feed's scale.
function SectionHead({ label, note, heart = false }: { label: string; note?: string; heart?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap mb-5">
      <p className="myra-section-label inline-flex items-center gap-2">
        {heart && <span className="text-[#C8302A]" aria-hidden>♥</span>}
        {label.toUpperCase()}
      </p>
      {note && <p className="myra-section-note">{note.toUpperCase()}</p>}
    </div>
  )
}

const LOOK_GRID = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[6px]'

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

const ACTION = 'pointer-events-auto text-white text-[15px] md:text-[18px] tracking-[0.1em] uppercase font-light hover:opacity-70 transition-opacity'

export default function MyLooksClient({ view, readOnly = false, initialQuery = '' }: { view: ClientView; readOnly?: boolean; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery)
  const [occasion, setOccasion] = useState<string | null>(null)
  // One "related" view drives Similar Looks, Explore Styles and Style Item —
  // the three actions differ only in how the row is chosen.
  const [related, setRelated] = useState<
    { anchor: ClientLook; mode: 'similar' | 'explore' } | { item: ClientLookItem; anchor: ClientLook } | null
  >(null)
  const [savedItems, setSavedItems] = useState<Set<string>>(new Set())
  const [asking, setAsking] = useState(false)
  const [recent, setRecent] = useState<string[]>([])

  // Which pieces are already hung in her wardrobe — the hearts in Shop the Look.
  useEffect(() => {
    if (readOnly) return
    getSavedItemIds().then((ids) => setSavedItems(new Set(ids))).catch(() => {})
  }, [readOnly])

  async function toggleItem(itemId: string) {
    setSavedItems((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId)
      return next
    })
    await toggleSaveItem(itemId)
    window.dispatchEvent(new Event('myra:item-saved'))
  }

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

  const relatedResults = useMemo(() => {
    if (!related) return []
    if ('item' in related) {
      return looksWearing(related.item.item_id ?? '', browsable, related.anchor.look_id)
    }
    return relatedLooks(related.anchor, browsable, related.mode, 6)
  }, [related, browsable])

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

  function showRelated(next: NonNullable<typeof related>) {
    setRelated(next)
    setOccasion(null)
    setQuery('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cardProps = (l: ClientLook) => ({
    look: l,
    readOnly,
    savedItems,
    onToggleItem: toggleItem,
    onOpen: () => noteViewed(l.look_id),
    onSimilar: () => { noteViewed(l.look_id); showRelated({ anchor: l, mode: 'similar' }) },
    onExplore: () => { noteViewed(l.look_id); showRelated({ anchor: l, mode: 'explore' }) },
    onStyleItem: (itemId: string) => {
      const item = l.items.find((i) => i.item_id === itemId)
      if (item) { noteViewed(l.look_id); showRelated({ item, anchor: l }) }
    },
  })

  return (
    // Full width of the screen (design principle): breaks out of whatever
    // column holds it, on the set-wall grey texture the feed stands on.
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${readOnly ? '' : '-my-10'}`}>
      <ClientWardrobe readOnly={readOnly} loved={loved} onOpenLook={(l) => { setRelated(null); setQuery(''); setOccasion(l.occasion_label) }} />

      <div className="w-full px-6 sm:px-10 pb-16 flex flex-col">
        {/* The mirror — the original home page's opening: it arrives huge and
            docks above the headline, with the search and occasions beneath. */}
        <div className="mb-14 -mx-6 sm:-mx-10 px-2 sm:px-10">
          <ArchiveCard
            className="w-full"
            // The mirror wiggles in, then settles near the top — no scrolling
            // to reach the question (Chloe, 2026-09-15).
            intro="settle"
            heading={
              <div className="text-center">
                <h1 className="text-[clamp(30px,5vw,86px)] tracking-[0.045em] text-[#4A4E57] leading-[1.05]">
                  WHAT ARE YOU DRESSING FOR?
                </h1>
                <p className="myra-section-note mt-4">{`STYLED FOR ${(view.name.split(' ')[0] || '').toUpperCase()}`}</p>
              </div>
            }
          >
            <div className="mx-auto w-full max-w-[900px] flex items-center justify-center gap-3 mb-5 md:mb-7">
              <span className="myra-field shrink-0 text-[#55524C]">SEARCH A LOOK</span>
              <div className="flex-1 min-w-0 border border-[#2B2B2B] flex items-center">
                <input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setOccasion(null); setRelated(null) }}
                  placeholder="TROUSERS FOR DINNER"
                  className="myra-field flex-1 min-w-0 bg-transparent border-0 px-4 md:px-6 py-3.5 md:py-4 placeholder:text-[#6E6B65] focus:outline-none"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="myra-field px-4 md:px-5 self-stretch border-l border-[#2B2B2B]">CLEAR</button>
                )}
              </div>
            </div>

            {/* ASK MYRA — right under the search, where she will see it. In the
                admin mirror it runs as a test for this member. */}
            {/* Full width, not a column: the test results lay six pieces per
                look across the screen and need the room. */}
            <div className="w-full mb-8 md:mb-10">
              {asking ? (
                <AskPanel
                  onDone={() => setAsking(false)}
                  testMemberId={readOnly ? view.memberId ?? undefined : undefined}
                  firstName={view.name.split(' ')[0] || 'her'}
                  occasionIds={view.occasions}
                />
              ) : (
                <button
                  onClick={() => setAsking(true)}
                  className="w-full border border-[#2B2B2B] bg-[rgba(255,255,255,0.18)] px-6 py-5 myra-field tracking-[0.14em] text-[#2B2B2B] hover:bg-[#2B2B2B] hover:text-white transition-colors"
                >
                  {readOnly ? `ASK MYRA — TEST AS ${(view.name.split(' ')[0] || 'HER').toUpperCase()}` : 'ASK MYRA FOR SOMETHING NEW'}
                </button>
              )}
            </div>

            {/* Occasion grid — the feed's 3-across contact grid, each occasion
                through one of her own looks, name in white at the centre. */}
            {!related && !searched && !occasion && occasions.length > 0 && (
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
                    <span className="absolute inset-0 flex items-center justify-center px-3 md:px-6 text-center text-white text-[19px] md:text-[34px] tracking-[0.14em] leading-[1.2] drop-shadow-[0_1px_8px_rgba(0,0,0,0.5)]">
                      {label.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </ArchiveCard>
        </div>

        {/* ── Similar Looks / Explore Styles / Style Item ──────────────────── */}
        {related && (
          <Results
            label={
              'item' in related
                ? `${related.item.product_name}, styled another way`
                : related.mode === 'similar'
                  ? 'Looks like this one'
                  : 'A different way to dress for it'
            }
            note={
              relatedResults.length
                ? `${relatedResults.length} of your looks`
                : 'item' in related
                  ? 'This is the only look you have wearing it'
                  : 'Nothing else of yours fits that yet'
            }
            onBack={() => setRelated(null)}
            looks={relatedResults}
            cardProps={cardProps}
            /* Style Item is the one case that can compose something new: if she
               has no other look wearing the piece, offer to make one. */
            empty={'item' in related && !readOnly ? (
              <StyleItemPrompt item={related.item} look={related.anchor} />
            ) : undefined}
          />
        )}

        {/* ── Search results ──────────────────────────────────────────────── */}
        {!related && searched && (
          <Results
            label={`“${query}”`}
            note={`${searched.length} look${searched.length === 1 ? '' : 's'}`}
            onBack={() => setQuery('')}
            looks={searched}
            cardProps={cardProps}
          />
        )}

        {/* ── One occasion, opened ────────────────────────────────────────── */}
        {!related && !searched && occasion && (
          <Results
            label={occasion}
            note={`${occasions.find(([o]) => o === occasion)?.[1].length ?? 0} looks`}
            onBack={() => setOccasion(null)}
            looks={occasions.find(([o]) => o === occasion)?.[1] ?? []}
            cardProps={cardProps}
          />
        )}

        {/* ── At rest ─────────────────────────────────────────────────────── */}
        {!related && !searched && !occasion && (
          <>
            {waiting.length > 0 && (
              <section className="mb-16">
                <SectionHead label="Waiting for you" note={`${waiting.length} look${waiting.length === 1 ? '' : 's'} to tell us about`} />
                <div className={LOOK_GRID}>
                  {waiting.slice(0, 3).map((l) => <LookCard key={l.look_id} {...cardProps(l)} />)}
                </div>
              </section>
            )}

            {becauseYouLoved.length > 0 && (
              <section className="mb-16">
                <SectionHead label="Because you loved" note="Built from pieces you said yes to" />
                <div className={LOOK_GRID}>
                  {becauseYouLoved.map((l) => <LookCard key={l.look_id} {...cardProps(l)} />)}
                </div>
              </section>
            )}

            {recentLooks.length > 0 && (
              <section className="mb-16">
                <SectionHead label="Recently viewed" />
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-[6px]">
                  {recentLooks.map((l) => (
                    <button
                      key={l.look_id}
                      onClick={() => showRelated({ anchor: l, mode: 'similar' })}
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
              <section className="mb-16">
                <SectionHead label="Looks you loved" note="Shaping what comes next" heart />
                <div className={LOOK_GRID}>
                  {loved.slice(0, 6).map((l) => <LookCard key={l.look_id} {...cardProps(l)} />)}
                </div>
              </section>
            )}

            {view.looks.length === 0 && (
              <p className="text-center myra-section-note py-12">
                YOUR FIRST LOOKS ARE ON THEIR WAY.
              </p>
            )}
          </>
        )}

      </div>
    </div>
  )
}

function Results({
  label, note, onBack, looks, cardProps, empty,
}: {
  label: string
  note: string
  onBack: () => void
  looks: ClientLook[]
  cardProps: (l: ClientLook) => Record<string, unknown>
  empty?: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-6 mb-6">
        <div>
          <p className="myra-section-label">{label.toUpperCase()}</p>
          <p className="myra-section-note mt-3">{note.toUpperCase()}</p>
        </div>
        <button onClick={onBack} className="myra-field underline underline-offset-[6px] shrink-0">BACK</button>
      </div>
      {looks.length === 0 ? (
        empty ?? <p className="text-center myra-section-note py-10">NOTHING HERE YET.</p>
      ) : (
        <div className={LOOK_GRID}>
          {looks.map((l) => <LookCard key={l.look_id} {...(cardProps(l) as any)} />)}
        </div>
      )}
    </section>
  )
}

function LookCard({
  look, readOnly, onSimilar, onExplore, onStyleItem, onOpen, savedItems, onToggleItem,
}: {
  look: ClientLook
  readOnly?: boolean
  onSimilar?: () => void
  onExplore?: () => void
  onStyleItem?: (itemId: string) => void
  onOpen?: () => void
  savedItems: Set<string>
  onToggleItem: (itemId: string) => void
}) {
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)
  const [slideIdx, setSlideIdx] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const didSwipe = useRef(false)

  const [verdict, setVerdict] = useState<'yes' | 'no' | null>(look.response)
  const [reason, setReason] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Same slide list as the feed card: the shoot first, then each piece.
  const slides = [
    ...(look.image_url ? [{ src: look.image_url, alt: look.occasion_label }] : []),
    ...look.items.filter((i) => i.image_url).map((i) => ({ src: i.image_url as string, alt: i.product_name })),
  ]
  const total = slides.length
  const current = total > 0 ? slideIdx % total : 0
  const next = () => setSlideIdx((i) => (i + 1) % total)
  const prev = () => setSlideIdx((i) => (i - 1 + total) % total)

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    didSwipe.current = false
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(delta) > 38) { didSwipe.current = true; delta < 0 ? next() : prev() }
  }

  async function send(v: 'yes' | 'no') {
    setVerdict(v)
    if (v === 'no' && !reason) return
    setSaving(true)
    const r = await reactToLook(look.look_id, v, reason, words)
    setSaving(false)
    if (!r.error) setSaved(true)
  }

  const total_gbp = look.items.reduce((n, i) => n + (i.owned ? 0 : (i.price_gbp ?? 0)), 0)

  return (
    <article className="relative flex flex-col bg-[#EDEBE7] border border-[#C3BFB8]">
      <div
        className="group relative aspect-[3/4] w-full overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {slides.length === 0 ? (
          <div className="absolute inset-0 bg-[#EDEDED]" />
        ) : (
          slides.map((sl, i) => (
            <FallbackImage
              key={i}
              src={sl.src}
              thumbWidth={640}
              alt={sl.alt}
              loading={i === 0 ? 'eager' : 'lazy'}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${i === current ? 'opacity-100' : 'opacity-0'}`}
            />
          ))
        )}

        {/* Right third flicks to the next image, exactly as on the feed card. */}
        {total > 1 && (
          <button aria-label="Next image" className="absolute right-0 top-0 h-full w-1/3 z-10" onClick={next} />
        )}

        {/* Style Item hotspots — see-through circles on the shoot itself. They
            show in the mirror too: they only ever navigate within her looks,
            and Chloe cannot check what she has not been shown. */}
        {current === 0 && look.items.filter((i) => i.item_id).map((it, i) => {
          const pos = slotPosition(it.slot ?? it.item_type ?? '')
          return (
            <Hotspot
              key={`${it.item_id}-${i}`}
              itemId={it.item_id as string}
              itemType={(it.item_type ?? 'top') as ItemType}
              x={pos.x}
              y={pos.y}
              variant="feed"
              onStyleItem={(itemId) => onStyleItem?.(itemId)}
            />
          )
        })}

        {/* Shop the look — the narrow column down the left of the photo. */}
        {sourcePanelOpen && look.items.length > 0 && (
          <div className="absolute inset-0 z-30" onClick={(e) => e.stopPropagation()}>
            <ShopTheLookOverlay
              items={look.items.map(asSourceItem)}
              onClose={() => setSourcePanelOpen(false)}
              size="large"
              canSave={!readOnly}
              savedItemIds={Array.from(savedItems)}
              onToggleItem={onToggleItem}
            />
          </div>
        )}

        {/* Actions — Source Items + Similar Looks on one line, Explore Styles
            underneath. Same rows, same class, same z-40 as the feed card. */}
        <div className="absolute inset-x-0 bottom-0 z-40 pt-10 pb-3.5 px-3 bg-gradient-to-t from-black/55 via-black/20 to-transparent pointer-events-none">
          <div className="flex items-center justify-center gap-x-4">
            <button onClick={(e) => { e.stopPropagation(); if (!sourcePanelOpen) onOpen?.(); setSourcePanelOpen((v) => !v) }} className={ACTION}>
              Source Items
            </button>
            <button onClick={(e) => { e.stopPropagation(); onSimilar?.() }} className={ACTION}>Similar Looks</button>
          </div>
          <div className="flex justify-center mt-1.5">
            <button onClick={(e) => { e.stopPropagation(); onExplore?.() }} className={ACTION}>Explore Styles</button>
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        {total_gbp > 0 && (
          <p className="text-[20px] text-[#55534E] mb-3">{look.items.length} pieces · £{Math.round(total_gbp)}</p>
        )}
        {readOnly ? (
          <p className="text-[20px] text-[#55534E]">
            {look.response === 'yes' ? 'She said she would wear this'
              : look.response === 'no' ? 'She said not for her'
              : 'She has not answered yet'}
          </p>
        ) : saved || (look.response && !verdict) ? (
          <p className="text-[20px] text-[#3D6B45]">
            {(saved ? verdict : look.response) === 'yes' ? 'Loved — noted.' : 'Noted, thank you.'}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => send('yes')}
                disabled={saving}
                className={`text-[20px] px-5 py-3 border transition-colors ${verdict === 'yes' ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'border-[#2B2B2B] text-[#2B2B2B] hover:bg-[rgba(255,255,255,0.35)]'}`}
              >
                I would wear this
              </button>
              <button
                onClick={() => setVerdict('no')}
                disabled={saving}
                className={`text-[20px] px-5 py-3 border transition-colors ${verdict === 'no' ? 'bg-[#55534E] text-white border-[#55534E]' : 'border-[#9B978F] text-[#55534E]'}`}
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
                      className={`text-[18px] px-3.5 py-2 border transition-colors ${reason === r.id ? 'border-[#2B2B2B] text-[#2B2B2B]' : 'border-[#C3BFB8] text-[#6E6B65]'}`}
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
                  className="w-full text-[20px] bg-transparent border border-[#C3BFB8] px-3 py-2.5 focus:outline-none focus:border-[#2B2B2B]"
                />
                <button
                  onClick={() => send('no')}
                  disabled={saving || !reason}
                  className="text-[20px] px-5 py-3 bg-[#2B2B2B] text-white disabled:opacity-40"
                >
                  {saving ? 'Sending…' : 'Send'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  )
}

/**
 * Her look items are denormalised onto the look row, so they are shaped for the
 * shop panel here rather than refetched. The panel only ever reads these
 * fields; the cast is the boundary between her stored look and the feed's
 * Item type.
 */
function asSourceItem(it: ClientLookItem): Item & { brand: Brand } {
  return {
    item_id: it.item_id ?? `unlinked-${it.product_name}`,
    product_name: it.product_name,
    image_url: it.image_url,
    // Owned pieces have no retailer link — the panel then shows no SHOP, which
    // is right: she already has it.
    retailer_url: it.owned ? null : it.url,
    price: it.price_gbp != null ? String(it.price_gbp) : null,
    currency: 'GBP',
    item_type: it.item_type,
    brand: { name: it.brand },
  } as unknown as Item & { brand: Brand }
}

// Where each piece's hotspot sits on the shoot — the feed's placeholder map.
function slotPosition(slot: string): { x: number; y: number } {
  const positions: Record<string, { x: number; y: number }> = {
    outerwear: { x: 50, y: 30 },
    top: { x: 45, y: 38 },
    bottom: { x: 50, y: 62 },
    dress: { x: 50, y: 50 },
    shoe: { x: 45, y: 88 },
    bag: { x: 70, y: 60 },
    jewellery: { x: 50, y: 22 },
    accessory: { x: 55, y: 20 },
  }
  return positions[slot] ?? { x: 50, y: 50 }
}

/**
 * The only thing on this page that cannot be answered from what she already
 * has: no other look of hers wears the piece, so MYRA has to make one.
 */
function StyleItemPrompt({ item, look }: { item: ClientLookItem; look: ClientLook }) {
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  if (sent) {
    return (
      <p className="text-center text-[20px] text-[#2B2B2B] py-10 max-w-[560px] mx-auto">
        MYRA is working on it. Your stylist checks the looks before they land here.
      </p>
    )
  }

  return (
    <div className="text-center py-10">
      <p className="text-[20px] text-[#55534E] mb-5">
        This is the only look you have wearing it.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await requestLooks(
            look.occasion_id ?? 'casual_day',
            null,
            `Style my ${item.brand} ${item.product_name} another way`,
          )
          setBusy(false)
          setSent(true)
        }}
        className="text-[20px] px-6 py-3.5 bg-[#2B2B2B] text-white disabled:opacity-40"
      >
        {busy ? 'Asking…' : 'Ask MYRA to style it another way'}
      </button>
    </div>
  )
}

function AskPanel({
  onDone, testMemberId, firstName, occasionIds,
}: {
  onDone: () => void
  /** Her occasions, most often first. Anything she never dresses for is not offered. */
  occasionIds?: string[]
  /** Set in the admin mirror: runs the composer as a test for this member —
   *  nothing is saved, sent or learned unless KEEP is pressed. */
  testMemberId?: string
  firstName: string
}) {
  const [occasion, setOccasion] = useState('')
  const [climate, setClimate] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AskPreviewResult | null>(null)
  const [kept, setKept] = useState(false)
  // Which test looks you have accepted — only these are kept.
  const [accepted, setAccepted] = useState<Set<number>>(new Set())
  // The open swap: which look, which piece, its options and the picker filters.
  const [swap, setSwap] = useState<{ look: number; piece: number; options: AskSwapOption[] | null; brands: { name: string; count: number }[]; types: string[] } | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [swapQ, setSwapQ] = useState('')
  const [swapBrand, setSwapBrand] = useState('')
  const [swapColour, setSwapColour] = useState('')
  const [swapType, setSwapType] = useState('')
  // What was changed on each test look — recorded as learning if it is kept.
  const [edits, setEdits] = useState<AskLookEdits[]>([])

  async function loadOptions(look: number, piece: number, f: { q: string; brand: string; colour: string; itemType: string }) {
    if (!preview) return
    setSwap((cur) => ({ look, piece, options: null, brands: cur?.look === look && cur?.piece === piece ? cur.brands : [], types: cur?.look === look && cur?.piece === piece ? cur.types : [] }))
    const r = await askPreviewAlternates(testMemberId!, occasion, climate, preview.looks[look].items, piece, f)
    if (r.error) { setSwapError(r.error); setSwap(null); return }
    setSwap({ look, piece, options: r.options ?? [], brands: r.brands ?? [], types: r.types ?? [] })
  }

  function openSwap(look: number, piece: number) {
    if (swap && swap.look === look && swap.piece === piece) { setSwap(null); return }
    setSwapError(null)
    setSwapQ(''); setSwapBrand(''); setSwapColour(''); setSwapType('')
    void loadOptions(look, piece, { q: '', brand: '', colour: '', itemType: '' })
  }

  // Filters re-query after a short pause, like the item picker.
  useEffect(() => {
    if (!swap) return
    const timer = setTimeout(() => {
      void loadOptions(swap.look, swap.piece, { q: swapQ, brand: swapBrand, colour: swapColour, itemType: swapType })
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapQ, swapBrand, swapColour, swapType])

  // Which looks are being re-checked after an edit (Claude's eye takes a few seconds).
  const [checking, setChecking] = useState<Set<number>>(new Set())

  // UNDO: each look keeps what it was before every swap or remove — the pieces,
  // its score and check, and its recorded edits — so undo is instant and the
  // learning never records a change that was taken back.
  type Snapshot = { kind: 'swap' | 'remove'; look: AskPreviewResult['looks'][number]; edits: AskLookEdits }
  const [history, setHistory] = useState<Record<number, Snapshot[]>>({})
  // Bumped on every edit and undo, so a re-check that finishes late never
  // overwrites a look that has changed since.
  const versions = useRef<Record<number, number>>({})

  function pushHistory(look: number, kind: Snapshot['kind']) {
    if (!preview) return
    const snap: Snapshot = { kind, look: preview.looks[look], edits: edits[look] ?? { swaps: [], removes: [] } }
    setHistory((h) => ({ ...h, [look]: [...(h[look] ?? []), snap] }))
  }

  function undo(look: number) {
    const stack = history[look]
    if (!stack?.length) return
    const snap = stack[stack.length - 1]
    versions.current[look] = (versions.current[look] ?? 0) + 1
    setHistory((h) => ({ ...h, [look]: stack.slice(0, -1) }))
    setPreview((cur) => cur && { ...cur, looks: cur.looks.map((l, i) => (i === look ? snap.look : l)) })
    setEdits((prev) => { const next = [...prev]; next[look] = snap.edits; return next })
    setChecking((s) => { const n = new Set(s); n.delete(look); return n })
    if (swap?.look === look) setSwap(null)
    setKept(false)
  }

  async function rescore(look: number, items: any[]) {
    if (!preview) return
    const v = (versions.current[look] = (versions.current[look] ?? 0) + 1)
    setChecking((s) => new Set(s).add(look))
    const r = await rescoreAskLook(testMemberId!, { items, notes: preview.looks[look].notes })
    if (versions.current[look] !== v) return
    setChecking((s) => { const n = new Set(s); n.delete(look); return n })
    if (r.error) return
    setPreview((cur) => cur && {
      ...cur,
      looks: cur.looks.map((l, i) => (i === look ? {
        ...l,
        score: r.score ?? l.score, high: r.high ?? l.high, reasons: r.reasons ?? l.reasons,
        check: r.check !== undefined ? r.check : l.check, sizes: r.sizes ?? l.sizes,
      } : l)),
    })
  }

  function recordEdit(look: number, apply: (e: AskLookEdits) => AskLookEdits) {
    setEdits((prev) => {
      const next = [...prev]
      next[look] = apply(next[look] ?? { swaps: [], removes: [] })
      return next
    })
  }

  async function useOption(look: number, piece: number, opt: AskSwapOption) {
    if (!preview) return
    pushHistory(look, 'swap')
    const out = preview.looks[look].items[piece] as any
    const items = preview.looks[look].items.map((it: any, j: number) => (j === piece ? opt.lookItem : it))
    setPreview({ ...preview, looks: preview.looks.map((l, i) => (i === look ? { ...l, items } : l)) })
    recordEdit(look, (e) => ({ ...e, swaps: [...e.swaps, { slot: out?.slot ?? null, out, in: opt.lookItem }] }))
    setSwap(null)
    setKept(false)
    await rescore(look, items)
  }

  async function removePiece(look: number, piece: number) {
    if (!preview) return
    pushHistory(look, 'remove')
    const out = preview.looks[look].items[piece] as any
    const items = preview.looks[look].items.filter((_: any, j: number) => j !== piece)
    setPreview({ ...preview, looks: preview.looks.map((l, i) => (i === look ? { ...l, items } : l)) })
    recordEdit(look, (e) => ({ ...e, removes: [...e.removes, { slot: out?.slot ?? null, out }] }))
    if (swap?.look === look) setSwap(null)
    setKept(false)
    await rescore(look, items)
  }

  const testing = !!testMemberId
  const chip = (on: boolean) =>
    `text-[20px] px-5 py-3 border transition-colors ${on ? 'border-[#2B2B2B] bg-[#2B2B2B] text-white' : 'border-[#6E6B65] text-[#2B2B2B] hover:border-[#2B2B2B]'}`

  async function submit() {
    setBusy(true)
    setError(null)
    setKept(false)
    setAccepted(new Set())
    setSwap(null)
    setEdits([])
    setHistory({})
    if (testing) {
      const r = await previewAskForMember(testMemberId!, occasion, climate)
      if (r.error) setError(r.error)
      else setPreview(r)
    } else {
      const r = await requestLooks(occasion, climate, words)
      if (r.error) setError(r.error)
      else setSent(true)
    }
    setBusy(false)
  }

  if (sent) {
    return (
      <div className="border border-[#2B2B2B] bg-[rgba(255,255,255,0.18)] px-6 py-6 text-center">
        <p className="text-[20px] text-[#2B2B2B]">
          MYRA is putting some looks together. Your stylist checks them before they land here.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-[#2B2B2B] bg-[rgba(255,255,255,0.18)] px-5 md:px-8 py-6 md:py-8 space-y-6">
      {testing && (
        <p className="text-[18px] tracking-[0.1em] text-[#8B5E00]">
          TEST AS {firstName.toUpperCase()} — THE REAL COMPOSER ON HER REAL HISTORY. NOTHING IS SENT TO HER, SAVED OR LEARNED UNTIL YOU KEEP A LOOK.
        </p>
      )}
      <div>
        <p className="text-[20px] text-[#2B2B2B] mb-3">What is it for?</p>
        <div className="flex flex-wrap gap-2.5">
          {(occasionIds?.length
            ? occasionIds.map((id) => CLIENT_OCCASIONS.find((o) => o.id === id)).filter((o): o is (typeof CLIENT_OCCASIONS)[number] => !!o)
            : CLIENT_OCCASIONS
          ).map((o) => (
            <button key={o.id} onClick={() => setOccasion(o.id)} className={chip(occasion === o.id)}>{o.label}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[20px] text-[#2B2B2B] mb-3">Where?</p>
        <div className="flex flex-wrap gap-2.5">
          {CLIENT_CLIMATES.map((c) => (
            <button key={c.id} onClick={() => setClimate(climate === c.id ? null : c.id)} className={chip(climate === c.id)}>{c.label}</button>
          ))}
        </div>
      </div>
      <textarea
        value={words}
        onChange={(e) => setWords(e.target.value)}
        rows={2}
        placeholder="Anything else MYRA should know"
        className="w-full text-[20px] bg-transparent border border-[#6E6B65] px-4 py-3 placeholder:text-[#6E6B65] focus:outline-none focus:border-[#2B2B2B]"
      />
      <div className="flex flex-wrap gap-3">
        <button
          disabled={!occasion || busy}
          onClick={submit}
          className="text-[20px] px-7 py-3.5 bg-[#2B2B2B] text-white disabled:opacity-40"
        >
          {busy ? (testing ? 'Composing…' : 'Sending…') : preview ? 'Run the test again' : testing ? 'Run the test' : 'Ask MYRA'}
        </button>
        <button onClick={onDone} className="text-[20px] px-7 py-3.5 border border-[#6E6B65] text-[#2B2B2B]">
          {preview ? 'Close' : 'Not now'}
        </button>
      </div>
      {error && <p className="text-[20px] text-[#B83A3A]">{error}</p>}

      {preview && (
        <div className="space-y-5 pt-2">
          <div>
            <p className="myra-section-label">WHAT MYRA WOULD MAKE</p>
            <p className="myra-section-note mt-3">
              {preview.looks.length} LOOKS · {preview.looks.filter((l) => l.check?.verdict === 'works').length} PASS MYRA&rsquo;S EYE ·{' '}
              {preview.scoreUsable
                ? 'EACH % IS CLAUDE LOOKING AT THE PHOTOS TOGETHER — COLOURS, PIECES, HER RULES — AND EVERY PIECE CHECKED IN HER SIZE'
                : 'THE LOOK CHECK DID NOT RUN — % IS FROM HER HISTORY ONLY AND IS NOT YET RELIABLE'}
            </p>
            {(preview.hiddenByCheck ?? 0) > 0 && (
              <p className="text-[18px] text-[#8B5E00] mt-3">
                {preview.hiddenByCheck} more look{preview.hiddenByCheck === 1 ? ' was' : 's were'} composed and not shown — the check caught: {preview.hiddenIssues?.join(' · ')}
              </p>
            )}
          </div>
          {preview.looks.map((l, i) => (
            <div key={i} className="border border-[#2B2B2B] bg-[#EDEBE7]">
              <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-4 border-b border-[#C3BFB8]">
                <div className="flex items-center gap-4">
                  <p className="text-[20px] text-[#2B2B2B]">LOOK {i + 1}</p>
                  <button
                    onClick={() => {
                      setKept(false)
                      setAccepted((prev) => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i); else next.add(i)
                        return next
                      })
                    }}
                    className={`text-[18px] tracking-[0.08em] px-4 py-2 border transition-colors ${accepted.has(i) ? 'bg-[#3D6B45] border-[#3D6B45] text-white' : 'border-[#6E6B65] text-[#2B2B2B] hover:border-[#2B2B2B]'}`}
                  >
                    {accepted.has(i) ? '✓ ACCEPTED' : 'ACCEPT THIS LOOK'}
                  </button>
                  {(history[i]?.length ?? 0) > 0 && (
                    <button
                      onClick={() => undo(i)}
                      className="text-[18px] tracking-[0.08em] px-4 py-2 border border-[#6E6B65] text-[#2B2B2B] hover:border-[#2B2B2B] transition-colors"
                      title="Put the look back as it was before your last change"
                    >
                      ↶ UNDO {history[i][history[i].length - 1].kind === 'swap' ? 'SWAP' : 'REMOVE'}
                    </button>
                  )}
                </div>
                <p className={`text-[20px] tracking-[0.06em] ${checking.has(i) ? 'text-[#6E6B65]' : l.check?.verdict === 'clashes' ? 'text-[#B83A3A]' : l.high ? 'text-[#3D6B45]' : 'text-[#8B5E00]'}`}>
                  {checking.has(i)
                    ? 'CHECKING THE LOOK…'
                    : `${Math.round(l.score * 100)}% · ${l.check
                      ? l.check.verdict === 'works' ? 'PASSES MYRA’S EYE' : l.check.verdict === 'borderline' ? 'ONE PIECE NEEDS A LOOK' : 'CLASHES'
                      : l.high ? 'HIGH CONFIDENCE' : 'NOT CHECKED'}`}
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-[6px] p-[6px]">
                {l.items.map((it: any, j: number) => (
                  <div key={j} className="bg-white">
                    <div className="relative aspect-[3/4] bg-[#EDEDED] overflow-hidden">
                      {it.image_url && (
                        <FallbackImage src={it.image_url} thumbWidth={500} alt={it.product_name} className="absolute inset-0 w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="text-[15px] tracking-[0.08em] text-[#6E6B65] uppercase truncate">
                        {it.brand}{it.item_type ? ` · ${String(it.item_type).replace(/_/g, ' ')}` : ''}
                      </p>
                      <p className="text-[20px] text-[#2B2B2B] leading-tight line-clamp-2">{it.product_name}</p>
                      {typeof it.price_gbp === 'number' && !it.owned && (
                        <p className="text-[20px] text-[#55534E]">£{Math.round(it.price_gbp)}</p>
                      )}
                      {it.owned && <p className="text-[18px] text-[#8B5E00]">Already hers</p>}
                      {!it.owned && it.item_id && l.sizes?.[it.item_id] && (
                        <p className={`text-[18px] ${l.sizes[it.item_id].verdict === 'in_size' ? 'text-[#3D6B45]' : l.sizes[it.item_id].verdict === 'not_in_size' ? 'text-[#B83A3A]' : 'text-[#8B5E00]'}`}>
                          {l.sizes[it.item_id].verdict === 'in_size'
                            ? `In her size${l.sizes[it.item_id].label ? ` · ${l.sizes[it.item_id].label}` : ''}`
                            : l.sizes[it.item_id].verdict === 'not_in_size' ? 'Not in her size' : 'Size not confirmed'}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        {it.slot && (
                          <button
                            onClick={() => openSwap(i, j)}
                            className={`text-[18px] tracking-[0.1em] underline underline-offset-4 ${swap?.look === i && swap?.piece === j ? 'text-[#2B2B2B]' : 'text-[#8B5E00]'}`}
                          >
                            {swap?.look === i && swap?.piece === j ? 'CLOSE' : '⇄ SWAP'}
                          </button>
                        )}
                        <button
                          onClick={() => removePiece(i, j)}
                          className="text-[18px] tracking-[0.1em] underline underline-offset-4 text-[#B83A3A]"
                        >
                          ✕ REMOVE
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Swap options for the open piece — the same ranking as ⇄ SWAP
                  on a composed look. Choosing one replaces it here only. */}
              {swap?.look === i && (
                <div className="border-t border-[#C3BFB8] px-[6px] pb-[6px]">
                  <p className="text-[20px] text-[#2B2B2B] px-2 pt-4 pb-3">
                    Swap {l.items[swap.piece]?.product_name} for:
                  </p>
                  {/* Search + brand, type and colour — the item picker's filters. */}
                  <div className="px-2 pb-4 space-y-3">
                    <div className="flex flex-wrap gap-3">
                      <input
                        value={swapQ}
                        onChange={(e) => setSwapQ(e.target.value)}
                        placeholder="Search pieces — brand, name, colour"
                        className="flex-1 min-w-[240px] text-[20px] bg-white border border-[#6E6B65] px-4 py-2.5 placeholder:text-[#8C8A85] focus:outline-none focus:border-[#2B2B2B]"
                      />
                      <select
                        value={swapBrand}
                        onChange={(e) => setSwapBrand(e.target.value)}
                        className="text-[20px] bg-white border border-[#6E6B65] px-3 py-2.5 focus:outline-none"
                      >
                        <option value="">All brands</option>
                        {swap.brands.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}
                      </select>
                    </div>
                    {swap.types.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setSwapType('')} className={`text-[16px] tracking-[0.08em] px-3 py-1.5 border ${!swapType ? 'bg-[#2B2B2B] border-[#2B2B2B] text-white' : 'border-[#9B978F] text-[#2B2B2B]'}`}>ALL TYPES</button>
                        {swap.types.map((ty) => (
                          <button key={ty} onClick={() => setSwapType(swapType === ty ? '' : ty)} className={`text-[16px] tracking-[0.08em] px-3 py-1.5 border ${swapType === ty ? 'bg-[#2B2B2B] border-[#2B2B2B] text-white' : 'border-[#9B978F] text-[#2B2B2B]'}`}>
                            {PICKER_TYPES.find((p) => p.value === ty)?.label ?? ty.replace(/_/g, ' ').toUpperCase()}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {PICKER_COLOURS.map((c) => (
                        <button
                          key={c.value}
                          onClick={() => setSwapColour(swapColour === c.value ? '' : c.value)}
                          title={c.label}
                          className={`flex items-center gap-2 text-[16px] tracking-[0.08em] px-3 py-1.5 border ${swapColour === c.value ? 'border-[#2B2B2B] bg-white' : 'border-[#C3BFB8]'}`}
                        >
                          <span className="w-4 h-4 rounded-full border border-[#9B978F]" style={{ background: c.swatch }} />
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[18px] text-[#55534E]">
                      {swap.options === null ? 'Finding pieces…' : swap.options.length ? `${swap.options.length} piece${swap.options.length === 1 ? '' : 's'} she can wear here` : 'Nothing matches — clear a filter.'}
                    </p>
                  </div>
                  {swap.options && swap.options.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-[6px]">
                      {swap.options.map((o) => (
                        <button key={o.item_id} onClick={() => useOption(i, swap.piece, o)} className="bg-white text-left hover:outline hover:outline-2 hover:outline-[#2B2B2B]">
                          <div className="relative aspect-[3/4] bg-[#EDEDED] overflow-hidden">
                            {o.image_url && <FallbackImage src={o.image_url} thumbWidth={400} alt={o.product_name} className="absolute inset-0 w-full h-full object-cover" />}
                          </div>
                          <div className="px-2.5 py-2">
                            <p className="text-[14px] tracking-[0.08em] text-[#6E6B65] uppercase truncate">{o.brand_name}{o.item_type ? ` · ${String(o.item_type).replace(/_/g, ' ')}` : ''}</p>
                            <p className="text-[18px] text-[#2B2B2B] leading-tight line-clamp-2">{o.product_name}</p>
                            {typeof o.price_gbp === 'number' && <p className="text-[18px] text-[#55534E]">£{Math.round(o.price_gbp)}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {l.reasons.length > 0 && (
                <p className="text-[18px] text-[#55534E] px-5 py-4 border-t border-[#C3BFB8]">
                  WHY: {l.reasons.join(' · ')}
                </p>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4">
            <button
              disabled={busy || kept || accepted.size === 0}
              onClick={async () => {
                setBusy(true)
                const keptIdx = preview.looks.map((_, i) => i).filter((i) => accepted.has(i))
                const chosen = keptIdx.map((i) => ({ items: preview.looks[i].items, notes: preview.looks[i].notes }))
                const chosenEdits = keptIdx.map((i) => edits[i] ?? { swaps: [], removes: [] })
                // Kept looks get a light Higgsfield shoot straight away.
                const r = await keepAskPreview(testMemberId!, occasion, climate, words, preview.mix, chosen, chosenEdits, true)
                setBusy(false)
                if (r.error) setError(r.error)
                else setKept(true)
              }}
              className="text-[20px] px-7 py-3.5 border border-[#2B2B2B] text-[#2B2B2B] hover:bg-[#2B2B2B] hover:text-white transition-colors disabled:opacity-40"
            >
              {kept
                ? `Kept ${accepted.size} — light shoot${accepted.size === 1 ? '' : 's'} started, in DELIVERIES as a draft`
                : accepted.size
                  ? `Keep ${accepted.size} accepted look${accepted.size === 1 ? '' : 's'} and shoot ${accepted.size === 1 ? 'it' : 'them'}`
                  : 'Accept a look to keep it'}
            </button>
            <p className="text-[18px] text-[#6E6B65]">Only accepted looks are kept, each with a light Higgsfield shoot — one picture, which lands on the draft in DELIVERIES in a few minutes. Swaps and removals on a kept look teach the composer, as on a delivery. She still sees nothing until you send.</p>
            {swapError && <p className="text-[20px] text-[#B83A3A] w-full">{swapError}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

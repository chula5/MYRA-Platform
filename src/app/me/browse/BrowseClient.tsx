'use client'

// BROWSE — looking something up.
//
// The bar rests in the middle of the page until she asks for something. When
// she does it travels up out of the way, and MYRA looks: the mirror wiggles
// while it does, the way it does everywhere else in the house.
//
// What comes back is only pieces she could actually buy, and only pieces that
// answer EVERYTHING she said — the label, the piece, the colour, the cloth,
// the occasion. What comes close waits behind SEE SIMILAR. She can narrow by
// brand, colour, piece and size (her own sizes come pre-filled), keep one she
// likes, or ask MYRA to style it. Tapping a piece opens it on the shop's own
// site (in Safari from the app) and keeps it chosen here for styling.

import { Fragment, useEffect, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import WaysToWear from '@/components/me/WaysToWear'
import { WAYS_READY_EVENT } from '@/components/me/ways-watch'
import { noticePieces } from '@/app/me/ways/actions'
import { WAYS } from '@/lib/styled-ways-core'
import { useScrollTo } from '@/lib/smooth-scroll'

// A dress form on its stand — the mark at the top of the page that wiggles
// while MYRA is styling a piece and goes still when the outfits are ready.
function Mannequin({ working }: { working: boolean }) {
  return (
    <svg viewBox="0 0 64 120" className={`h-16 w-auto text-[#2B2B2B] ${working ? 'myra-mirror-wiggle' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M32 4v8" />
      <circle cx="32" cy="4" r="2.5" />
      <path d="M22 14c0 8-3 12-6 18-3 7-2 16 4 20h24c6-4 7-13 4-20-3-6-6-10-6-18" />
      <path d="M20 52c-6 6-8 16-6 26 1 5 6 8 18 8s17-3 18-8c2-10 0-20-6-26" />
      <path d="M32 86v24" />
      <path d="M18 114c4-3 24-3 28 0" />
    </svg>
  )
}
import ShopLink, { type ShopLinkItem } from '@/components/ShopLink'
import {
  browseSearch, saveBrowsedPiece,
  type BrowsePiece, type BrowseFacets, type BrowseSizes, type BrowseFilters,
} from './actions'

/** What to try when she has not thought of anything yet. */
const PROMPTS = ['A black dress for a winter wedding', 'Leather jacket', 'Silk slip skirt', 'Something for the office']

const EMPTY_FACETS: BrowseFacets = { brands: [], colours: [], types: [] }
const EMPTY_SIZES: BrowseSizes = { clothing: [], shoes: [], mineClothing: [], mineShoes: [], hasClothing: false, hasShoes: false }

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** A card in view this long is one she is looking at, not scrolling past. */
const DWELL_MS = 1_500
/** Noticed cards travel to the server together, once the scroll settles. */
const FLUSH_MS = 800
/** Cards styled before she asks, per search — a scroll must not spend the judge on everything. */
const BROWSE_WARM_PER_SEARCH = 8

export default function BrowseClient() {
  const [draft, setDraft] = useState('')
  /** The question MYRA is answering. Set the moment she asks, so the bar lifts. */
  const [asked, setAsked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pieces, setPieces] = useState<BrowsePiece[] | null>(null)
  const [similar, setSimilar] = useState<BrowsePiece[]>([])
  const [similarKind, setSimilarKind] = useState<'brands' | 'close' | null>(null)
  const [brandName, setBrandName] = useState<string | null>(null)
  const [showSimilar, setShowSimilar] = useState(false)
  const [read, setRead] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const [facets, setFacets] = useState<BrowseFacets>(EMPTY_FACETS)
  const [sizes, setSizes] = useState<BrowseSizes>(EMPTY_SIZES)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [fBrands, setFBrands] = useState<string[]>([])
  const [fColours, setFColours] = useState<string[]>([])
  const [fTypes, setFTypes] = useState<string[]>([])
  const [fClothing, setFClothing] = useState<number[]>([])
  const [fShoes, setFShoes] = useState<number[]>([])
  // Her own sizes seed the picker once, so a fresh search opens set to her.
  const sizeTouched = useRef(false)

  const [picked, setPicked] = useState<string | null>(null)
  const [styling, setStyling] = useState<'wardrobe' | 'new' | null>(null)
  // Where the styling has got to, for the button and the mark at the top.
  const [phase, setPhase] = useState<'idle' | 'working' | 'ready' | 'failed'>('idle')
  const waysRef = useRef<HTMLDivElement | null>(null)
  const scrollTo = useScrollTo()
  const [note, setNote] = useState<string | null>(null)
  // How many of the three ways have landed while MYRA styles the chosen piece.
  const [landed, setLanded] = useState(0)

  // Styled before she asks (lib/styled-ways-queue). A card she rests on for a
  // moment, or picks, is noticed: its ways in the shopping pool are queued
  // then, so STYLE IT WITH SOMETHING NEW usually opens on an instant answer.
  // Pieces that already have their ways carry a small mark.
  const [ready, setReady] = useState<Set<string>>(new Set())
  const observer = useRef<IntersectionObserver | null>(null)
  const cardIds = useRef<WeakMap<Element, string>>(new WeakMap())
  const dwell = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pending = useRef<Set<string>>(new Set())
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warmedThisSearch = useRef<Set<string>>(new Set())

  const markReady = (ids: string[]) => {
    if (ids.length) setReady((s) => { const n = new Set(s); ids.forEach((id) => n.add(id)); return n })
  }
  function flushNotice() {
    flush.current = null
    const ids = Array.from(pending.current); pending.current.clear()
    if (!ids.length) return
    noticePieces(ids, 'inspiration', 'browse').then((r) => markReady(r.ready)).catch(() => { /* a warm-up is a nicety */ })
  }
  function noticeCard(id: string) {
    if (warmedThisSearch.current.has(id) || warmedThisSearch.current.size >= BROWSE_WARM_PER_SEARCH) return
    warmedThisSearch.current.add(id)
    pending.current.add(id)
    if (!flush.current) flush.current = setTimeout(flushNotice, FLUSH_MS)
  }
  function forgetCards() {
    observer.current?.disconnect()
    dwell.current.forEach(clearTimeout); dwell.current.clear()
    warmedThisSearch.current.clear()
  }
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const timers = dwell.current
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = cardIds.current.get(e.target)
        if (!id) continue
        const t = timers.get(id)
        if (e.isIntersecting) {
          if (!t) timers.set(id, setTimeout(() => { timers.delete(id); noticeCard(id) }, DWELL_MS))
        } else if (t) { clearTimeout(t); timers.delete(id) }
      }
    }, { threshold: 0.6 })
    observer.current = io
    // A piece she walked away from mid-styling shows its mark when it lands.
    const onReady = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.mode === 'inspiration' && d.itemId) markReady([d.itemId]) }
    window.addEventListener(WAYS_READY_EVENT, onReady)
    return () => {
      io.disconnect(); observer.current = null
      timers.forEach(clearTimeout); timers.clear()
      if (flush.current) clearTimeout(flush.current)
      window.removeEventListener(WAYS_READY_EVENT, onReady)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const registerCard = (el: HTMLElement | null, id: string) => {
    if (!el || !observer.current) return
    cardIds.current.set(el, id)
    observer.current.observe(el)
  }

  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)

  const started = asked != null
  const chosen = pieces?.find((p) => p.item_id === picked) ?? similar.find((p) => p.item_id === picked) ?? null
  const activeCount = fBrands.length + fColours.length + fTypes.length + fClothing.length + fShoes.length

  async function run(query: string, filters: BrowseFilters = currentFilters()) {
    const q = query.trim()
    if (!q) return
    setAsked(q); setDraft(q)
    setBusy(true); setPieces(null); setError(null)
    setPicked(null); setStyling(null); setNote(null); setLanded(0)
    forgetCards()
    const r = await browseSearch(q, filters)
    setBusy(false)
    setPieces(r.pieces); setRead(r.read); setError(r.error ?? null)
    setSimilar(r.similar); setSimilarKind(r.similarKind); setBrandName(r.brand)
    // Nothing exact: what comes close is the answer, so it is shown at once.
    setShowSimilar(r.pieces.length === 0 && r.similar.length > 0)
    setFacets(r.facets); setSizes(r.sizes)
    if (!sizeTouched.current) { setFClothing(r.sizes.mineClothing); setFShoes(r.sizes.mineShoes) }
  }

  function currentFilters(): BrowseFilters {
    return { brands: fBrands, colours: fColours, types: fTypes, clothingSizes: fClothing, shoeSizes: fShoes }
  }

  // A brand-new question starts from a clean slate, so last search's filters
  // don't silently cull the next one.
  async function ask(query: string) {
    sizeTouched.current = false
    setFBrands([]); setFColours([]); setFTypes([]); setFClothing([]); setFShoes([]); setFiltersOpen(false)
    await run(query, {})
  }

  // The sheet asks, waits and keeps (lib/styled-ways): judged before it shows,
  // instant the next time she opens the same piece in the same pool.
  function style(_piece: BrowsePiece, mode: 'wardrobe' | 'new') {
    setStyling((cur) => (cur === mode ? null : mode)); setPhase('idle'); setNote(null)
  }
  useEffect(() => {
    if (!styling || !waysRef.current) return
    const el = waysRef.current
    const id = window.setTimeout(() => scrollTo(el, { offset: -96 }), 60)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styling, picked])
  const progress = landed > 0 && landed < WAYS ? `${landed} OF ${WAYS}` : 'STYLING…'
  const styleLabel = (mode: 'wardrobe' | 'new', idle: string) =>
    styling !== mode ? idle : phase === 'working' ? progress : phase === 'ready' ? 'DONE' : idle

  async function save(piece: BrowsePiece) {
    if (saved.has(piece.item_id) || savingId) return
    setSavingId(piece.item_id)
    const r = await saveBrowsedPiece(piece.item_id)
    setSavingId(null)
    if (r.saved) setSaved((s) => new Set(s).add(piece.item_id))
    else if (r.error) setNote(r.error)
  }

  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const shopItem = (p: BrowsePiece) => ({
    item_id: p.item_id,
    retailer_url: p.url,
    product_name: p.product_name,
    brand: p.brand ? { name: p.brand } : null,
  })

  const pick = (p: BrowsePiece) => {
    if (picked === p.item_id) { setPicked(null); setStyling(null); setPhase('idle'); setNote(null); return }
    setPicked(p.item_id); setStyling(null); setNote(null); setLanded(0)
    // A head start: her pick is styled in the shopping pool before she chooses a button.
    noticePieces([p.item_id], 'inspiration', 'pick').then((r) => markReady(r.ready)).catch(() => { /* a warm-up is a nicety */ })
  }

  const similarTitle = similarKind === 'brands'
    ? `MORE LIKE ${(brandName ?? asked ?? '').toUpperCase()}`
    : 'SIMILAR TO WHAT YOU ASKED'

  // The piece she picked, and the outfits MYRA builds around it. Drawn in the
  // grid itself, spanning the row under her piece — never down past the whole
  // grid where she might miss them. Dense flow lets the pieces after hers
  // close up the rest of that row.
  const stylePanel = chosen && styling ? (
    <div ref={waysRef} className="col-span-full rounded-[22px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-5 sm:px-8 py-7 scroll-mt-6">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <p className="text-[16px] sm:text-[18px] tracking-[0.14em] text-[#2B2B2B] mr-auto">
          {(chosen.brand ? `${chosen.brand} · ` : '') + chosen.product_name.toUpperCase()}
        </p>
        <button
          type="button"
          onClick={() => void save(chosen)}
          disabled={savingId === chosen.item_id || saved.has(chosen.item_id)}
          className="text-[16px] tracking-[0.06em] rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-6 py-3 disabled:opacity-40"
        >
          {saved.has(chosen.item_id) ? 'SAVED' : savingId === chosen.item_id ? 'SAVING…' : 'SAVE'}
        </button>
        {chosen.url && (
          <ShopLink
            item={shopItem(chosen)}
            className="text-[16px] tracking-[0.06em] rounded-full bg-[#B48A5A] text-white px-6 py-3"
          >
            VIEW ON SITE
          </ShopLink>
        )}
      </div>
      <WaysToWear
        inline
        key={`${chosen.item_id}-${styling}`}
        itemId={chosen.item_id}
        mode={styling === 'wardrobe' ? 'wardrobe' : 'inspiration'}
        piece={{ item_id: chosen.item_id, product_name: chosen.product_name, brand: chosen.brand ?? null, image_url: chosen.image_url ?? null }}
        heading={styling === 'wardrobe' ? 'WITH YOUR WARDROBE' : 'WITH SOMETHING NEW'}
        onStatus={(st, n) => { setLanded(n); setPhase(st === 'opening' || st === 'working' ? 'working' : st === 'ready' ? 'ready' : st === 'idle' ? 'idle' : 'failed') }}
        onClose={() => { setStyling(null); setPhase('idle') }}
      />
    </div>
  ) : null

  const grid = (list: BrowsePiece[]) => (
    <div className="grid grid-flow-row-dense grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
      {list.map((p) => (
        <Fragment key={p.item_id}>
          <PieceCard
            piece={p}
            shopItem={shopItem(p)}
            picked={picked === p.item_id}
            styling={picked === p.item_id ? styling : null}
            working={picked === p.item_id && phase === 'working'}
            saved={saved.has(p.item_id)}
            saving={savingId === p.item_id}
            ready={ready.has(p.item_id)}
            cardRef={(el) => registerCard(el, p.item_id)}
            onPick={() => pick(p)}
            onStyle={(mode) => void style(p, mode)}
            onSave={() => void save(p)}
          />
          {picked === p.item_id && stylePanel}
        </Fragment>
      ))}
    </div>
  )

  return (
    <div className="w-full">
      {/* The bar: middle of the page until she asks, then up out of the way. */}
      <div className={`transition-[padding] duration-500 ease-out ${started ? 'pt-0' : 'pt-[20vh]'}`}>
        <form onSubmit={(e) => { e.preventDefault(); void ask(draft) }} className="relative w-full max-w-[1100px] mx-auto px-1">
          <button type="submit" aria-label="Search" className="absolute left-6 sm:left-8 top-1/2 -translate-y-1/2 p-1 text-[#55534E] hover:text-[#2B2B2B]">
            <svg viewBox="0 0 17 16" fill="none" className="w-6 h-6 sm:w-8 sm:h-8" aria-hidden>
              <path d="M7.667 12.667A5.333 5.333 0 107.667 2a5.333 5.333 0 000 10.667zM14.334 14l-2.9-2.9" stroke="currentColor" strokeWidth="1.333" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search better through MYRA"
            aria-label="Search through MYRA"
            data-tour="browse-search"
            type="text"
            className="w-full rounded-full bg-white border-2 border-transparent shadow-md transition-all duration-300 focus:outline-none focus:border-[#2B2B2B] text-[#2B2B2B] placeholder:text-[#8C8A85] text-[18px] sm:text-[clamp(22px,1.5vw,32px)] pl-16 sm:pl-20 pr-14 sm:pr-20 py-4 sm:py-6"
          />
          {draft && (
            <button type="button" onClick={() => setDraft('')} aria-label="Clear search" className="absolute right-6 sm:right-8 top-1/2 -translate-y-1/2 p-1 text-[#55534E] hover:text-[#2B2B2B]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6 sm:w-8 sm:h-8" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </form>

        {!started && (
          <>
            <p className="myra-guide-text normal-case text-center text-[18px] sm:text-[21px] text-[#6E6B65] mt-5">
              Ask in your own words. MYRA reads the colour, the piece and the occasion, then finds it.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void ask(p)}
                  className="text-[16px] sm:text-[18px] tracking-[0.04em] rounded-full border border-[rgba(43,43,43,0.25)] px-5 py-2.5 text-[#2B2B2B] hover:bg-white"
                >
                  {p}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* MYRA looking: the mirror it always waits with. */}
      {busy && (
        <div className="mt-14 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-28 sm:h-40 w-auto mx-auto" />
          <p className="mt-5 text-[15px] tracking-[0.16em] text-[#6E6B65]">MYRA IS LOOKING…</p>
        </div>
      )}

      {error && !busy && <p className="text-[17px] text-[#B83A3A] mt-8">{error}</p>}

      {!busy && pieces && (
        <div className="mt-10">
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {read.length > 0 && (
              <p className="text-[16px] sm:text-[18px] tracking-[0.14em] text-[#6E6B65] mr-auto">READ AS {read.join(' · ')}</p>
            )}
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={`ml-auto text-[16px] sm:text-[18px] tracking-[0.1em] rounded-full border px-5 py-2.5 ${activeCount ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'border-[rgba(43,43,43,0.3)] text-[#2B2B2B] hover:bg-white'}`}
            >
              FILTER{activeCount ? ` · ${activeCount}` : ''}
            </button>
          </div>

          {filtersOpen && (
            <div className="rounded-[18px] bg-white/90 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-5 sm:px-7 py-6 mb-7">
              {facets.brands.length === 0 && facets.colours.length === 0 && facets.types.length === 0 && (
                <p className="myra-guide-text normal-case text-[16px] text-[#6E6B65] pb-2">Nothing to narrow by for this search yet — sizes are below.</p>
              )}
              {facets.brands.length > 0 && (
                <FilterRow label="BRAND">
                  {facets.brands.map((b) => (
                    <Chip key={b} on={fBrands.includes(b)} onClick={() => toggle(fBrands, setFBrands, b)}>{b.toUpperCase()}</Chip>
                  ))}
                </FilterRow>
              )}
              {facets.colours.length > 0 && (
                <FilterRow label="COLOUR">
                  {facets.colours.map((c) => (
                    <Chip key={c} on={fColours.includes(c)} onClick={() => toggle(fColours, setFColours, c)}>{titleCase(c).toUpperCase()}</Chip>
                  ))}
                </FilterRow>
              )}
              {facets.types.length > 0 && (
                <FilterRow label="PIECE">
                  {facets.types.map((t) => (
                    <Chip key={t} on={fTypes.includes(t)} onClick={() => toggle(fTypes, setFTypes, t)}>{titleCase(t).toUpperCase()}</Chip>
                  ))}
                </FilterRow>
              )}
              {sizes.hasClothing && (
                <FilterRow label="SIZE">
                  {sizes.clothing.map((n) => (
                    <Chip key={`c${n}`} on={fClothing.includes(n)} onClick={() => { sizeTouched.current = true; toggle(fClothing, setFClothing, n) }}>UK {n}</Chip>
                  ))}
                </FilterRow>
              )}
              {sizes.hasShoes && (
                <FilterRow label="SHOE SIZE">
                  {sizes.shoes.map((n) => (
                    <Chip key={`s${n}`} on={fShoes.includes(n)} onClick={() => { sizeTouched.current = true; toggle(fShoes, setFShoes, n) }}>UK {n}</Chip>
                  ))}
                </FilterRow>
              )}
              <div className="flex items-center gap-3 mt-5">
                <button
                  type="button"
                  onClick={() => { setFiltersOpen(false); if (asked) void run(asked) }}
                  className="text-[14px] tracking-[0.08em] rounded-full bg-[#2B2B2B] text-white px-6 py-2.5"
                >
                  APPLY
                </button>
                <button
                  type="button"
                  onClick={() => {
                    sizeTouched.current = true
                    setFBrands([]); setFColours([]); setFTypes([]); setFClothing([]); setFShoes([])
                    if (asked) void run(asked, {})
                  }}
                  className="text-[14px] tracking-[0.08em] text-[#6E6B65] underline underline-offset-4"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {pieces.length === 0 && similar.length === 0 && (
            <p className="myra-guide-text normal-case text-[19px] text-[#4A4E57]">Nothing for that yet. Try it another way.</p>
          )}
          {pieces.length === 0 && similar.length > 0 && (
            <p className="myra-guide-text normal-case text-[19px] text-[#4A4E57] mb-5">
              Nothing exact for that yet. Here is what comes close.
            </p>
          )}
          {pieces.length > 0 && (
            <div className="flex justify-center mb-8">
              <p
                className={`${picked ? '' : 'animate-bounce'} bg-white rounded-full px-8 xl:px-10 py-4 xl:py-5 text-[19px] xl:text-[24px] tracking-[0.12em] text-[#2B2B2B] shadow-[0_2px_16px_rgba(43,43,43,0.16)]`}
                style={{ animationIterationCount: 3 }}
              >
                STYLE ANY ITEM · TAP STYLE ON IT ↓
              </p>
            </div>
          )}
          {pieces.length > 0 && grid(pieces)}

          {/* What answers most of her words, never in front of the real answers. */}
          {similar.length > 0 && pieces.length > 0 && !showSimilar && (
            <div className="text-center mt-10">
              <button
                type="button"
                onClick={() => setShowSimilar(true)}
                className="text-[14px] tracking-[0.1em] rounded-full border border-[rgba(43,43,43,0.3)] text-[#2B2B2B] px-6 py-3 hover:bg-white"
              >
                {similarKind === 'brands' ? `SEE BRANDS LIKE ${(brandName ?? asked ?? '').toUpperCase()}` : 'SEE SIMILAR'} · {similar.length}
              </button>
            </div>
          )}
          {similar.length > 0 && showSimilar && (
            <div className={pieces.length > 0 ? 'mt-12' : ''}>
              {pieces.length > 0 && <p className="text-[14px] tracking-[0.16em] text-[#6E6B65] mb-5">{similarTitle}</p>}
              {grid(similar)}
            </div>
          )}
        </div>
      )}

      {/* The mark at the top of the page: the dress form wiggles while MYRA
          styles, then stands still and says DONE — tap it to come to the outfits. */}
      {chosen && styling && (phase === 'working' || phase === 'ready') && (
        <button
          type="button"
          onClick={() => { if (waysRef.current) scrollTo(waysRef.current, { offset: -96 }) }}
          className="fixed top-[210px] right-5 sm:right-8 z-[60] flex items-center gap-3 rounded-full bg-white/95 shadow-[0_10px_30px_-12px_rgba(43,43,43,0.6)] pl-3 pr-5 py-2"
          aria-live="polite"
        >
          <Mannequin working={phase === 'working'} />
          <span className="text-[16px] xl:text-[18px] tracking-[0.14em] text-[#2B2B2B]">{phase === 'working' ? progress : 'DONE · SEE IT'}</span>
        </button>
      )}
      {note && !styling && <p className="myra-guide-text normal-case text-[18px] text-[#4A4E57] mt-6">{note}</p>}
    </div>
  )
}

// ONE PIECE. The picture and the name are a real link to the shop's own page,
// through the tracked click-out, opened in a new tab — from the iOS app that
// is Safari. Tapping also chooses the piece here, so the two ways to style it
// are waiting when she comes back. STYLE chooses without leaving the page.
function PieceCard({ piece, shopItem, picked, styling, working = false, saved, saving, ready = false, cardRef, onPick, onStyle, onSave }: {
  piece: BrowsePiece
  shopItem: ShopLinkItem
  picked: boolean
  /** Which way she is styling this piece, when it is the one she picked. */
  styling: 'wardrobe' | 'new' | null
  working?: boolean
  saved: boolean
  saving: boolean
  /** MYRA already has this piece's ways in the shopping pool: a tap is instant. */
  ready?: boolean
  cardRef?: (el: HTMLDivElement | null) => void
  onPick: () => void
  onStyle: (mode: 'wardrobe' | 'new') => void
  onSave: () => void
}) {
  const choice = (mode: 'wardrobe' | 'new', label: string) => {
    const on = styling === mode
    return (
      <button
        type="button"
        onClick={() => onStyle(mode)}
        disabled={working && !on}
        className={`text-[14px] xl:text-[15px] tracking-[0.1em] rounded-full px-4 py-2.5 shadow-[0_1px_8px_rgba(43,43,43,0.18)] text-left whitespace-nowrap disabled:opacity-40 ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white/95 text-[#2B2B2B] hover:bg-white'}`}
      >
        {on && working ? 'STYLING…' : label}
      </button>
    )
  }
  const body = (
    <>
      <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
        {piece.image_url && <FallbackImage src={piece.image_url} thumbWidth={600} alt={piece.product_name} className="absolute inset-0 w-full h-full object-cover" />}
      </div>
      <div className="px-4 py-3.5">
        {piece.brand && <p className="text-[15px] sm:text-[16px] tracking-[0.12em] text-[#6E6B65] truncate">{piece.brand.toUpperCase()}</p>}
        <p className="text-[17px] sm:text-[19px] text-[#2B2B2B] leading-snug truncate mt-0.5">{piece.product_name}</p>
        {piece.price_gbp != null && <p className="text-[16px] sm:text-[18px] text-[#6E6B65] mt-1">£{Math.round(piece.price_gbp)}</p>}
        {ready && <p className="text-[14px] sm:text-[15px] tracking-[0.12em] text-[#7C838B] mt-1.5">STYLED · READY</p>}
      </div>
    </>
  )
  return (
    <div ref={cardRef} className={`relative text-left bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)] transition-shadow ${picked ? 'ring-2 ring-[#2B2B2B]' : ''}`}>
      {piece.url ? (
        <ShopLink item={shopItem} onNavigate={onPick} className="block w-full text-left">
          {body}
        </ShopLink>
      ) : (
        <button type="button" onClick={onPick} className="block w-full text-left">{body}</button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        aria-label={saved ? 'Saved' : 'Save'}
        className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full bg-white/90 shadow-[0_1px_6px_rgba(43,43,43,0.14)] grid place-items-center text-[#2B2B2B] disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M12 21s-7.5-4.9-10-9.3C.6 8.9 2 5.5 5.2 5.5c2 0 3.3 1.2 3.8 2.3h6c.5-1.1 1.8-2.3 3.8-2.3 3.2 0 4.6 3.4 3.2 6.2C19.5 16.1 12 21 12 21z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onPick}
        aria-label={`Style ${piece.product_name}`}
        className={`absolute top-2.5 left-2.5 text-[16px] xl:text-[18px] tracking-[0.12em] rounded-full px-5 py-3 shadow-[0_2px_10px_rgba(43,43,43,0.18)] ${picked ? 'bg-[#2B2B2B] text-white' : 'bg-white/90 text-[#2B2B2B] hover:bg-white'}`}
      >
        {picked ? 'CHOSEN ✕' : 'STYLE'}
      </button>
      {/* Tapped: the two ways to style it, right under the button. */}
      {picked && (
        <div className="absolute top-[64px] left-2.5 flex flex-col gap-2 z-10">
          {choice('wardrobe', 'WITH MY WARDROBE')}
          {choice('new', 'WITH SOMETHING NEW')}
        </div>
      )}
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5 border-b border-[rgba(43,43,43,0.08)] last:border-0">
      <span className="text-[15px] tracking-[0.14em] text-[#6E6B65] w-full sm:w-[120px] shrink-0">{label}</span>
      {children}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[16px] tracking-[0.04em] rounded-full border px-4 py-2 ${on ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'border-[rgba(43,43,43,0.28)] text-[#2B2B2B] hover:bg-white'}`}
    >
      {children}
    </button>
  )
}

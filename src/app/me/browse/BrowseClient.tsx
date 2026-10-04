'use client'

// BROWSE — looking something up.
//
// The bar rests in the middle of the page until she asks for something. When
// she does it travels up out of the way, and MYRA looks: the mirror wiggles
// while it does, the way it does everywhere else in the house.
//
// What comes back is only pieces she could actually buy. She can narrow by
// brand, colour, piece and size (her own sizes come pre-filled), keep one she
// likes, open it on the shop's site, or ask MYRA to style it.

import { useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import ComposedLookCard from '@/components/me/ComposedLookCard'
import ShopLink from '@/components/ShopLink'
import type { StyledLook } from '@/app/admin/private-stylist/actions'
import {
  browseSearch, styleBrowsedPiece, saveBrowsedPiece,
  type BrowsePiece, type BrowseFacets, type BrowseSizes, type BrowseFilters,
} from './actions'

/** What to try when she has not thought of anything yet. */
const PROMPTS = ['A black dress for a winter wedding', 'Leather jacket', 'Silk slip skirt', 'Something for the office']

const EMPTY_FACETS: BrowseFacets = { brands: [], colours: [], types: [] }
const EMPTY_SIZES: BrowseSizes = { clothing: [], shoes: [], mineClothing: [], mineShoes: [], hasClothing: false, hasShoes: false }

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export default function BrowseClient() {
  const [draft, setDraft] = useState('')
  /** The question MYRA is answering. Set the moment she asks, so the bar lifts. */
  const [asked, setAsked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pieces, setPieces] = useState<BrowsePiece[] | null>(null)
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
  const [looks, setLooks] = useState<StyledLook[]>([])
  const [note, setNote] = useState<string | null>(null)

  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)

  const started = asked != null
  const chosen = pieces?.find((p) => p.item_id === picked) ?? null
  const activeCount = fBrands.length + fColours.length + fTypes.length + fClothing.length + fShoes.length

  async function run(query: string, filters: BrowseFilters = currentFilters()) {
    const q = query.trim()
    if (!q) return
    setAsked(q); setDraft(q)
    setBusy(true); setPieces(null); setError(null)
    setPicked(null); setLooks([]); setNote(null)
    const r = await browseSearch(q, filters)
    setBusy(false)
    setPieces(r.pieces); setRead(r.read); setError(r.error ?? null)
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

  async function style(piece: BrowsePiece, mode: 'wardrobe' | 'new') {
    if (styling) return
    setStyling(mode); setLooks([]); setNote(null)
    const r = await styleBrowsedPiece(piece.item_id, mode)
    setStyling(null)
    setLooks(r.looks)
    setNote(r.error ?? (r.looks.length ? null : 'MYRA could not build a look around this one.'))
  }

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

  return (
    <div className="w-full">
      {/* The bar: middle of the page until she asks, then up out of the way. */}
      <div className={`transition-[padding] duration-500 ease-out ${started ? 'pt-0' : 'pt-[20vh]'}`}>
        <form onSubmit={(e) => { e.preventDefault(); void ask(draft) }} className="relative w-full max-w-[760px] mx-auto px-1">
          <button type="submit" aria-label="Search" className="absolute left-5 top-1/2 -translate-y-1/2 p-1 text-[#55534E] hover:text-[#2B2B2B]">
            <svg viewBox="0 0 17 16" fill="none" className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden>
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
            className="w-full rounded-full bg-white border-2 border-transparent shadow-md transition-all duration-300 focus:outline-none focus:border-[#2B2B2B] text-[#2B2B2B] placeholder:text-[#8C8A85] text-[17px] sm:text-[clamp(19px,1.3vw,26px)] pl-16 pr-14 py-4"
          />
          {draft && (
            <button type="button" onClick={() => setDraft('')} aria-label="Clear search" className="absolute right-5 top-1/2 -translate-y-1/2 p-1 text-[#55534E] hover:text-[#2B2B2B]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden>
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
                  className="text-[15px] tracking-[0.04em] rounded-full border border-[rgba(43,43,43,0.25)] px-4 py-2 text-[#2B2B2B] hover:bg-white"
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
              <p className="text-[14px] tracking-[0.16em] text-[#6E6B65] mr-auto">READ AS {read.join(' · ')}</p>
            )}
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={`ml-auto text-[14px] tracking-[0.1em] rounded-full border px-4 py-2 ${activeCount ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'border-[rgba(43,43,43,0.3)] text-[#2B2B2B] hover:bg-white'}`}
            >
              FILTER{activeCount ? ` · ${activeCount}` : ''}
            </button>
          </div>

          {filtersOpen && (
            <div className="rounded-[18px] bg-white/90 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-5 sm:px-7 py-6 mb-7">
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

          {pieces.length === 0 ? (
            <p className="myra-guide-text normal-case text-[19px] text-[#4A4E57]">Nothing for that yet. Try it another way.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {pieces.map((p) => (
                <div
                  key={p.item_id}
                  className={`relative text-left bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)] transition-shadow ${picked === p.item_id ? 'ring-2 ring-[#2B2B2B]' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => { setPicked(p.item_id); setLooks([]); setNote(null) }}
                    className="block w-full text-left"
                  >
                    <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                      {p.image_url && <FallbackImage src={p.image_url} thumbWidth={600} alt={p.product_name} className="absolute inset-0 w-full h-full object-cover" />}
                    </div>
                    <div className="px-3 py-2.5">
                      {p.brand && <p className="text-[12px] tracking-[0.12em] text-[#6E6B65] truncate">{p.brand.toUpperCase()}</p>}
                      <p className="text-[15px] text-[#2B2B2B] leading-tight truncate">{p.product_name}</p>
                      {p.price_gbp != null && <p className="text-[13px] text-[#6E6B65] mt-0.5">£{Math.round(p.price_gbp)}</p>}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void save(p)}
                    disabled={savingId === p.item_id}
                    aria-label={saved.has(p.item_id) ? 'Saved' : 'Save'}
                    className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full bg-white/90 shadow-[0_1px_6px_rgba(43,43,43,0.14)] grid place-items-center text-[#2B2B2B] disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill={saved.has(p.item_id) ? 'currentColor' : 'none'} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M12 21s-7.5-4.9-10-9.3C.6 8.9 2 5.5 5.2 5.5c2 0 3.3 1.2 3.8 2.3h6c.5-1.1 1.8-2.3 3.8-2.3 3.2 0 4.6 3.4 3.2 6.2C19.5 16.1 12 21 12 21z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The piece she picked, and the two ways to see it. */}
      {chosen && !busy && (
        <section className="mt-9 rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-6 sm:px-8 py-7">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[15px] tracking-[0.14em] text-[#2B2B2B] mr-auto">
              {(chosen.brand ? `${chosen.brand} · ` : '') + chosen.product_name.toUpperCase()}
            </p>
            <button
              type="button"
              onClick={() => void style(chosen, 'wardrobe')}
              disabled={!!styling}
              className="text-[15px] tracking-[0.06em] rounded-full bg-[#2B2B2B] text-white px-6 py-3 disabled:opacity-40"
            >
              {styling === 'wardrobe' ? 'BUILDING…' : 'STYLE IT WITH MY WARDROBE'}
            </button>
            <button
              type="button"
              onClick={() => void style(chosen, 'new')}
              disabled={!!styling}
              className="text-[15px] tracking-[0.06em] rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-6 py-3 disabled:opacity-40"
            >
              {styling === 'new' ? 'BUILDING…' : 'STYLE IT WITH SOMETHING NEW'}
            </button>
            <button
              type="button"
              onClick={() => void save(chosen)}
              disabled={savingId === chosen.item_id || saved.has(chosen.item_id)}
              className="text-[15px] tracking-[0.06em] rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-6 py-3 disabled:opacity-40"
            >
              {saved.has(chosen.item_id) ? 'SAVED' : savingId === chosen.item_id ? 'SAVING…' : 'SAVE'}
            </button>
            {chosen.url && (
              <ShopLink
                item={shopItem(chosen)}
                className="text-[15px] tracking-[0.06em] rounded-full bg-[#B48A5A] text-white px-6 py-3"
              >
                VIEW ON SITE
              </ShopLink>
            )}
          </div>

          {styling && (
            <div className="rounded-[16px] bg-white/70 px-6 py-10 text-center mt-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-24 w-auto mx-auto" />
              <p className="mt-4 text-[17px] text-[#4A4E57]">
                {styling === 'wardrobe' ? 'Looking through your wardrobe…' : 'Finding something new for it…'}
              </p>
            </div>
          )}

          {note && !styling && <p className="myra-guide-text normal-case text-[18px] text-[#4A4E57] mt-5">{note}</p>}

          {looks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-6">
              {looks.map((l, i) => <ComposedLookCard key={l.look_id ?? i} look={l} heroId={chosen.item_id} />)}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5 border-b border-[rgba(43,43,43,0.08)] last:border-0">
      <span className="text-[12px] tracking-[0.14em] text-[#6E6B65] w-full sm:w-[96px] shrink-0">{label}</span>
      {children}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[13px] tracking-[0.04em] rounded-full border px-3.5 py-1.5 ${on ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'border-[rgba(43,43,43,0.28)] text-[#2B2B2B] hover:bg-white'}`}
    >
      {children}
    </button>
  )
}

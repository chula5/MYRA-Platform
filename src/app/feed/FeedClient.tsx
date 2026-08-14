'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import OutfitCard from '@/components/outfit-card/OutfitCard'
import SaveHeartButton from '@/components/outfit-card/SaveHeartButton'
import { createClient } from '@/lib/supabase'
import { rankByTaste, isZero } from '@/lib/taste-vector'
import { recordTasteInteraction } from '@/app/edit/save-actions'
import { recordSearchQuery, recordLandingEvent } from '@/app/actions/landing-analytics'
import { getStoredRef } from '@/lib/ref'
import { useScrollTo } from '@/lib/smooth-scroll'
import { parseQuery, searchOutfits } from '@/lib/search-taxonomy'
import FallbackImage from '@/components/FallbackImage'
import { brandLogo } from '@/lib/brand-logos'
import BrandLogoTile from '@/components/BrandLogoTile'
import NewArrivals, { byNewest } from '@/components/NewArrivals'
import OurPicks from '@/components/OurPicks'
import TasteDecks from '@/components/TasteDecks'
import { ArchiveCard } from '@/components/ArchiveCard'
import { occasionLooks } from '@/components/OccasionLookCard'
import { thumbUrl } from '@/lib/image-utils'
import SizeFilter from './SizeFilter'
import { outfitFitsClothingUk } from '@/lib/sizing'
import { occasionLabel, BASE_OCCASIONS, CANDIDATE_OCCASIONS, occasionMatchTags } from '@/lib/occasions'

// The reference box holds a 3-across, 2-deep contact grid of occasions.
const OCCASION_GRID_COUNT = 6
import type { BrandRow } from '@/lib/taste-profile'
import type { OutfitWithItems, ItemType, ColourFamily } from '@/types/database'

// Example occasions that "type" themselves into the search bar as a prompt.
const SEARCH_EXAMPLES = [
  'A GIRLS HOLIDAY IN MYKONOS',
  'A SUMMER WEDDING IN ITALY',
  'DINNER ON A ROOFTOP',
  'SUMMER OFFICE ATTIRE',
  'BRUNCH WITH THE GIRLS',
  'A FIRST DATE',
  'A WEEKEND IN THE COUNTRYSIDE',
  'A BLACK LACE DRESS FOR A PARTY',
]

// ── Preset occasions ──────────────────────────────────────────
const PRESET_OCCASIONS = [
  { label: 'WEEKEND AWAY', tag: 'weekend away' },
  { label: 'SUMMER OFFICE ATTIRE', tag: 'summer office' },
  { label: 'WEDDING GUEST', tag: 'wedding guest' },
  { label: 'DATE NIGHT', tag: 'date night' },
  { label: 'CITY SUMMER EVENING', tag: 'city summer evening' },
  { label: 'CASUAL SUMMER WEEKEND', tag: 'casual summer weekend' },
]

// ── Colour filter options ────────────────────────────────────
const COLOUR_OPTIONS: { label: string; value: ColourFamily; swatch: string }[] = [
  { label: 'WHITE',     value: 'white',      swatch: '#F8F8F6' },
  { label: 'CREAM',     value: 'cream',      swatch: '#F0EAD6' },
  { label: 'BLACK',     value: 'black',      swatch: '#0A0A0A' },
  { label: 'GREY',      value: 'grey',       swatch: '#9B9B9B' },
  { label: 'NAVY',      value: 'navy',       swatch: '#1B2A4A' },
  { label: 'BROWN',     value: 'brown',      swatch: '#7B4F2E' },
  { label: 'CAMEL',     value: 'camel',      swatch: '#C4A882' },
  { label: 'GREEN',     value: 'green',      swatch: '#3D6B4F' },
  { label: 'BURGUNDY',  value: 'burgundy',   swatch: '#6B1C2A' },
  { label: 'RED',       value: 'red',        swatch: '#C8302A' },
  { label: 'BLUE',      value: 'blue',       swatch: '#4A6FA5' },
  { label: 'PINK',      value: 'pink',       swatch: '#E8A0B4' },
  { label: 'YELLOW',    value: 'yellow',     swatch: '#D4A843' },
  { label: 'ORANGE',    value: 'orange',     swatch: '#D4703A' },
  { label: 'PURPLE',    value: 'purple',     swatch: '#7B4FA0' },
  { label: 'MULTI',     value: 'multicolour',swatch: 'linear-gradient(135deg,#E8A0B4 0%,#4A6FA5 50%,#3D6B4F 100%)' },
]

// ── Filter-bar box ───────────────────────────────────────────
// One cell of the landing filter bar: printed label on the left, a bordered
// rectangle beside it showing the chosen value (or the muted "ALL …" state).
function FilterBox({
  label,
  value,
  placeholder,
  open,
  onClick,
}: {
  label: string
  value: string | null
  placeholder: string
  open: boolean
  onClick: () => void
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="myra-field shrink-0 text-[#55524C]">{label}</span>
      <button
        type="button"
        onClick={onClick}
        className="myra-field flex-1 md:flex-none flex items-center justify-between gap-4 border border-[#2B2B2B] bg-transparent px-4 py-2.5 min-w-0 md:min-w-[180px] text-left hover:bg-[rgba(255,255,255,0.25)] transition-colors"
      >
        <span className={`truncate ${value ? '' : 'opacity-45'}`}>{value ?? placeholder}</span>
        <span className="shrink-0">{open ? '▲' : '▾'}</span>
      </button>
    </div>
  )
}

// ── Item type groups ─────────────────────────────────────────
const ITEM_GROUPS: { label: string; types: string[] }[] = [
  { label: 'DRESS',       types: ['mini_dress','midi_dress','maxi_dress','shirt_dress','slip_dress'] },
  { label: 'SKIRT',       types: ['skirt'] },
  { label: 'TROUSERS',    types: ['trousers','jeans'] },
  { label: 'SHORTS',      types: ['shorts'] },
  { label: 'TOP',         types: ['shirt','blouse','t-shirt','knitwear','corset','bodysuit'] },
  { label: 'COAT',        types: ['coat','trench'] },
  { label: 'JACKET',      types: ['jacket','blazer','gilet','cape'] },
  { label: 'SHOES',       types: ['boot','heel','flat','sneaker','mule','sandal'] },
  { label: 'BAG',         types: ['tote','shoulder_bag','clutch','crossbody','structured_bag'] },
  { label: 'JEWELLERY',   types: ['necklace','earrings','bracelet','ring','brooch'] },
  { label: 'ACCESSORIES', types: ['belt','scarf','hair_accessory','hat','gloves','sunglasses'] },
]

// ── Anti-repetition ordering ──────────────────────────────────
function outfitCategory(o: OutfitWithItems): string {
  const types = (o.outfit_item ?? [])
    .filter((oi) => oi.item)
    .map((oi) => String(oi.item.item_type))
  if (types.some((t) => ['mini_dress','midi_dress','maxi_dress','shirt_dress','slip_dress'].includes(t))) return 'dress'
  if (types.includes('skirt')) return 'skirt'
  if (types.some((t) => ['trousers','jeans','shorts'].includes(t))) return 'trousers'
  if (types.some((t) => ['shirt','blouse','t-shirt','knitwear','corset','bodysuit'].includes(t))) return 'top'
  return 'other'
}

function antiRepeatOrder(list: OutfitWithItems[]): OutfitWithItems[] {
  const buckets: Record<string, OutfitWithItems[]> = {}
  for (const o of list) {
    const c = outfitCategory(o)
    ;(buckets[c] ||= []).push(o)
  }
  const cats = Object.keys(buckets)
  if (cats.length <= 1) return list
  const result: OutfitWithItems[] = []
  let lastCat: string | null = null
  while (result.length < list.length) {
    let bestCat: string | null = null
    let bestLen = -1
    for (const cat of cats) {
      const arr = buckets[cat]
      if (arr.length === 0 || cat === lastCat) continue
      if (arr.length > bestLen) { bestLen = arr.length; bestCat = cat }
    }
    if (bestCat === null) {
      for (const cat of cats) { const arr = buckets[cat]; while (arr.length) result.push(arr.shift()!) }
      break
    }
    result.push(buckets[bestCat].shift()!)
    lastCat = bestCat
  }
  return result
}

// ── Anchor de-duplication ─────────────────────────────────────
// The "anchor" is the hero garment an outfit is built around (the dress, or the
// top/bottom). Several outfits can share the same anchor styled different ways —
// in the occasion feed we only want to show each anchor ONCE; the other stylings
// stay reachable via SIMILAR LOOKS / EXPLORE STYLES.
function anchorItemId(o: OutfitWithItems): string | null {
  const its = (o.outfit_item ?? []).filter((oi) => oi.item)
  const bySlot = (slot: string) => its.find((oi) => oi.slot === slot)?.item_id
  return (
    bySlot('dress') ||
    bySlot('top') ||
    bySlot('bottom') ||
    bySlot('outerwear') ||
    its[0]?.item_id ||
    null
  )
}

function dedupeByAnchor(list: OutfitWithItems[]): OutfitWithItems[] {
  const seen = new Set<string>()
  const out: OutfitWithItems[] = []
  for (const o of list) {
    const a = anchorItemId(o)
    if (a && seen.has(a)) continue
    if (a) seen.add(a)
    out.push(o)
  }
  return out
}

// Rotate a taste-ranked list by how many times the user has opened this
// occasion. First visit (count 0) = pure taste order (best foot forward); each
// RETURN rotates the start, so different looks lead and the feed feels alive.
function rotateByVisit(list: OutfitWithItems[], tag: string): OutfitWithItems[] {
  if (list.length <= 2 || typeof window === 'undefined') return list
  let visits: Record<string, number> = {}
  try { visits = JSON.parse(localStorage.getItem('myra_occ_visits') || '{}') } catch { /* ignore */ }
  const v = visits[tag] ?? 0
  visits[tag] = v + 1
  try { localStorage.setItem('myra_occ_visits', JSON.stringify(visits)) } catch { /* ignore */ }
  const shift = (v * 4) % list.length
  return shift ? [...list.slice(shift), ...list.slice(0, shift)] : list
}

// ── Outfit matching logic ─────────────────────────────────────

// Match token as a whole word so "red" doesn't match "flared", "tailored", "structured" etc.
function wordMatch(text: string | null | undefined, token: string): boolean {
  if (!text) return false
  return new RegExp(`\\b${token}\\b`, 'i').test(text)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Search-word → colour_family (incl. common synonyms).
const COLOUR_WORDS: Record<string, ColourFamily> = {
  white: 'white', ivory: 'white', cream: 'cream', ecru: 'cream', beige: 'cream', oatmeal: 'cream',
  black: 'black', grey: 'grey', gray: 'grey', charcoal: 'grey', slate: 'grey',
  navy: 'navy', blue: 'blue', cobalt: 'blue', teal: 'blue', powder: 'blue',
  brown: 'brown', chocolate: 'brown', camel: 'camel', tan: 'camel', taupe: 'camel',
  green: 'green', olive: 'green', sage: 'green', khaki: 'green', emerald: 'green', forest: 'green',
  burgundy: 'burgundy', wine: 'burgundy', maroon: 'burgundy', oxblood: 'burgundy',
  red: 'red', scarlet: 'red', crimson: 'red',
  pink: 'pink', blush: 'pink', rose: 'pink', fuchsia: 'pink',
  yellow: 'yellow', mustard: 'yellow', lemon: 'yellow',
  orange: 'orange', rust: 'orange', terracotta: 'orange', coral: 'orange',
  purple: 'purple', lilac: 'purple', lavender: 'purple', violet: 'purple', plum: 'purple', mauve: 'purple',
  multi: 'multicolour', multicolour: 'multicolour', multicoloured: 'multicolour', floral: 'multicolour', print: 'multicolour',
}

const _DRESS = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress']
const _TOPS = ['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit']
const _SHOES = ['boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal']
const _BAGS = ['tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag']
const _JEWEL = ['necklace', 'earrings', 'bracelet', 'ring', 'brooch']

// Search-word → the item_types it refers to.
const TYPE_WORDS: Record<string, string[]> = {
  dress: _DRESS, dresses: _DRESS, gown: ['maxi_dress'], gowns: ['maxi_dress'],
  maxi: ['maxi_dress'], midi: ['midi_dress'], mini: ['mini_dress'], slip: ['slip_dress'],
  skirt: ['skirt'], skirts: ['skirt'],
  trouser: ['trousers'], trousers: ['trousers'], pant: ['trousers'], pants: ['trousers'],
  jean: ['jeans'], jeans: ['jeans'], short: ['shorts'], shorts: ['shorts'],
  top: _TOPS, tops: _TOPS, shirt: ['shirt'], shirts: ['shirt'], blouse: ['blouse'], blouses: ['blouse'],
  tee: ['t-shirt'], tshirt: ['t-shirt'], knit: ['knitwear'], knitwear: ['knitwear'], jumper: ['knitwear'], sweater: ['knitwear'], cardigan: ['knitwear'], corset: ['corset'], bodysuit: ['bodysuit'],
  coat: ['coat'], coats: ['coat'], trench: ['trench'], jacket: ['jacket'], jackets: ['jacket'], blazer: ['blazer'], blazers: ['blazer'], gilet: ['gilet'], cape: ['cape'],
  shoe: _SHOES, shoes: _SHOES, boot: ['boot'], boots: ['boot'], heel: ['heel'], heels: ['heel'], pump: ['heel'], pumps: ['heel'], flat: ['flat'], flats: ['flat'], sneaker: ['sneaker'], sneakers: ['sneaker'], trainer: ['sneaker'], trainers: ['sneaker'], mule: ['mule'], mules: ['mule'], sandal: ['sandal'], sandals: ['sandal'],
  bag: _BAGS, bags: _BAGS, handbag: _BAGS, tote: ['tote'], clutch: ['clutch'], crossbody: ['crossbody'],
  jewellery: _JEWEL, jewelry: _JEWEL, necklace: ['necklace'], earring: ['earrings'], earrings: ['earrings'], bracelet: ['bracelet'], ring: ['ring'], brooch: ['brooch'],
  belt: ['belt'], scarf: ['scarf'], hat: ['hat'], sunglasses: ['sunglasses'],
}

function matchesSearch(
  outfit: OutfitWithItems,
  query: string,
  colour: ColourFamily | null,
  itemTypes: string[] | null,
  brand: string,
  knownBrands: string[] = [],
): boolean {
  const items = (outfit.outfit_item ?? []).filter(oi => oi.item).map(oi => oi.item)

  // Colour filter — exact match on colour_family enum value
  if (colour) {
    if (!items.some(it => it.colour_family === colour)) return false
  }

  // Item type filter
  if (itemTypes && itemTypes.length > 0) {
    if (!items.some(it => itemTypes.includes(String(it.item_type)))) return false
  }

  // Brand filter — substring OK here (partial brand name is useful)
  if (brand.trim()) {
    const b = brand.toLowerCase()
    if (!items.some(it => (it as any).brand?.name?.toLowerCase().includes(b))) return false
  }

  // Free text. Pull out a brand name first, then classify the remaining words as
  // COLOUR / ITEM-TYPE / free. Brand + type + colour must all hold on the SAME
  // item — "jacquemus trousers" means trousers that ARE Jacquemus, not a
  // Jacquemus bag standing next to someone else's trousers.
  if (query.trim()) {
    let q = query.toLowerCase().trim()
    let brandTok: string | null = null
    for (const b of knownBrands) {
      if (new RegExp(`\\b${escapeRe(b)}\\b`).test(q)) {
        brandTok = b
        q = q.replace(new RegExp(`\\b${escapeRe(b)}\\b`, 'g'), ' ')
        break
      }
    }

    const tokens = q.split(/\s+/).filter(Boolean)
    const colourTokens = tokens.filter(t => COLOUR_WORDS[t])
    const wantTypes = new Set(tokens.flatMap(t => TYPE_WORDS[t] ?? []))
    const freeTokens = tokens.filter(t => !COLOUR_WORDS[t] && !TYPE_WORDS[t])

    // "blue" colloquially includes navy; everything else is its single family.
    const famsFor = (tok: string): ColourFamily[] => (tok === 'blue' ? ['blue', 'navy'] : [COLOUR_WORDS[tok]])

    if (brandTok || wantTypes.size || colourTokens.length) {
      const ok = items.some((it: any) => {
        if (brandTok && !(it.brand?.name ?? '').toLowerCase().includes(brandTok)) return false
        if (wantTypes.size && !wantTypes.has(String(it.item_type))) return false
        if (colourTokens.length && !colourTokens.some(tok => famsFor(tok).includes(it.colour_family) || wordMatch(it.product_name, tok))) return false
        return true
      })
      if (!ok) return false
    }

    // Remaining descriptive words (material, occasion, aesthetic) — anywhere.
    for (const token of freeTokens) {
      const hit = items.some((it: any) =>
        wordMatch(it.product_name, token) ||
        wordMatch(it.brand?.name, token) ||
        wordMatch(it.material_primary, token) ||
        wordMatch(String(it.item_type).replace(/_/g, ' '), token),
      ) ||
        wordMatch(outfit.aesthetic_label, token) ||
        (outfit.occasion_tags ?? []).some(t => wordMatch(t, token))
      if (!hit) return false
    }
  }

  return true
}

// ── Component ────────────────────────────────────────────────
// EXPLORE from the NEW OUTFITS row opens this pseudo-occasion: the most
// recently added live looks, in pure recency order (no taste rotation).
const NEW_TAG = '__new__'
const LATEST_COUNT = 24

export default function FeedClient({
  showAllOption = false,
  injectedOutfits,
  detailHrefBase = '/outfit',
  canSave = false,
  savedOutfitIds = [],
  recommendedOutfits = [],
  tasteVector,
  brandRows = [],
  occasionOrder,
  signupHref,
  defaultSizeUk = null,
  stylists = [],
  ourPicks,
}: {
  showAllOption?: boolean
  injectedOutfits?: OutfitWithItems[]
  detailHrefBase?: string
  // Save (heart) + recommendations — only passed for signed-in early-access users.
  canSave?: boolean
  savedOutfitIds?: string[]
  recommendedOutfits?: OutfitWithItems[]
  // The viewer's 34-dim taste vector — re-ranks the occasion feed by cosine.
  tasteVector?: number[]
  // Discovery rows from brands the user engages with.
  brandRows?: BrandRow[]
  // Personalised order of occasion tiles (tags); falls back to the base six.
  occasionOrder?: string[]
  // When set (anonymous visitors), a sign-up prompt appears after the first
  // occasion tap or search. Links here ("/earlyaccess").
  signupHref?: string
  // Signed-in shopper's saved clothing size (canonical UK) — pre-fills the size
  // filter so the feed defaults to their size (with a "show all" escape).
  defaultSizeUk?: number | null
  // Live stylists — the feed can be browsed through one stylist's lens.
  // Switching is free and instant: a FILTER, not an account setting. The
  // viewer's own taste vector keeps learning regardless of the active lens.
  stylists?: { stylist_id: string; name: string; slug: string }[]
  ourPicks?: import('@/lib/our-picks').OurPicksData
}) {
  // Lenis-aware scroll (see lib/smooth-scroll) — the feed jumps back to the top
  // whenever the view changes underneath it.
  const scrollTo = useScrollTo()
  const hasTaste = !!tasteVector && !isZero(tasteVector)
  // Signed-out on the public site: show greyed "sign in to save" hearts.
  const lockedSave = !canSave && !!signupHref
  // Occasion gates the catalogue; cosine ranks what's left (highest taste
  // similarity first), falling back to anti-repetition when there's no signal.
  const orderForFeed = (list: OutfitWithItems[]): OutfitWithItems[] =>
    hasTaste ? rankByTaste(tasteVector!, list).map((r) => r.outfit) : antiRepeatOrder(list)
  const savedSet = new Set(savedOutfitIds)
  // Clothing size filter (canonical UK). Pre-filled from the signed-in shopper's
  // saved size; anonymous choices persist for the session. null = all sizes.
  const [sizeUk, setSizeUk] = useState<number | null>(defaultSizeUk)
  useEffect(() => {
    if (defaultSizeUk == null) {
      const s = sessionStorage.getItem('myra_size_uk')
      if (s) setSizeUk(Number(s) || null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (sizeUk == null) sessionStorage.removeItem('myra_size_uk')
    else sessionStorage.setItem('myra_size_uk', String(sizeUk))
  }, [sizeUk])
  // Stylist lens — free, instant filter; persists for the session only.
  const [stylistFilter, setStylistFilter] = useState<string | null>(null)
  useEffect(() => {
    const s = sessionStorage.getItem('myra_stylist_lens')
    if (s) setStylistFilter(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!stylistFilter) sessionStorage.removeItem('myra_stylist_lens')
    else sessionStorage.setItem('myra_stylist_lens', stylistFilter)
  }, [stylistFilter])
  const fitsSize = useCallback(
    (o: OutfitWithItems) =>
      (sizeUk == null || outfitFitsClothingUk(o, sizeUk)) &&
      (stylistFilter == null || ((o as any).stylist_id ?? null) === stylistFilter),
    [sizeUk, stylistFilter],
  )
  // Occasion mode
  const [occasion, setOccasion]           = useState<string | null>(null)
  // True from the moment a search or occasion is chosen until its images are
  // decoded. Drives the hanger loader and the one-shot reveal of the grid.
  const [preparing, setPreparing]         = useState(false)
  // A brand the user tapped to "discover more" — shows that brand's outfits.
  const [brandView, setBrandView]         = useState<BrandRow | null>(null)
  // OUR RECOMMENDATIONS — a second tab of the landing, signed-in only: the
  // taste-ranked picks as a 3×3 grid with the liked-brand logos beneath.
  const [recsView, setRecsView]           = useState(false)
  const [outfits, setOutfits]             = useState<OutfitWithItems[]>([])
  const [loading, setLoading]             = useState(false)
  const [loadingMore, setLoadingMore]     = useState(false)
  const [offset, setOffset]               = useState(0)
  const [hasMore, setHasMore]             = useState(true)
  const loadMoreRef                        = useRef<HTMLDivElement>(null)
  // The rotated, taste-ranked list for the current occasion (computed once at
  // offset 0, then paginated from) so the feed feels alive on each return.
  const occOrderedRef                      = useRef<OutfitWithItems[]>([])

  // Search / filter mode
  const [searchQuery, setSearchQuery]     = useState('')
  const [filterColour, setFilterColour]   = useState<ColourFamily | null>(null)
  const [filterItemGroup, setFilterItemGroup] = useState<string | null>(null)
  const [filterBrand, setFilterBrand]     = useState('')
  const [filterPanel, setFilterPanel]     = useState<'colour' | 'item' | 'brand' | null>(null)
  const [searchMode, setSearchMode]       = useState(false)
  const [searchResults, setSearchResults] = useState<OutfitWithItems[]>([])
  const [searchRelaxed, setSearchRelaxed] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [typedHint, setTypedHint] = useState('')

  // Typewriter — cycle example occasions into the search placeholder.
  useEffect(() => {
    let phrase = 0
    let char = 0
    let deleting = false
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const full = SEARCH_EXAMPLES[phrase]
      if (!deleting) {
        char++
        setTypedHint(full.slice(0, char))
        if (char === full.length) { deleting = true; timer = setTimeout(tick, 1800); return }
        timer = setTimeout(tick, 55)
      } else {
        char--
        setTypedHint(full.slice(0, char))
        if (char === 0) { deleting = false; phrase = (phrase + 1) % SEARCH_EXAMPLES.length; timer = setTimeout(tick, 400); return }
        timer = setTimeout(tick, 28)
      }
    }
    timer = setTimeout(tick, 700)
    return () => clearTimeout(timer)
  }, [])

  const LIMIT = 9
  const router = useRouter()

  // Anonymous visitors: once they engage (pick an occasion or search), nudge
  // them to create a login. Fires a window event the SignupPrompt listens for.
  useEffect(() => {
    if (!signupHref) return
    if (!occasion && !searchMode) return
    try {
      if (sessionStorage.getItem('myra_signup_prompted') === '1') return
      sessionStorage.setItem('myra_signup_prompted', '1')
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('myra:engage'))
  }, [occasion, searchMode, signupHref])

    // Give the first row of images a moment to decode so the grid arrives sharp
  // rather than filling in tile by tile. Deliberately SHORT: this blocks an
  // otherwise-empty screen, so a long ceiling here reads as the page hanging.
  // Whatever hasn't decoded in time simply loads normally after the reveal.
  function preloadImages(urls: (string | null | undefined)[], cap = 6, timeoutMs = 9000) {
    const list = urls.filter(Boolean).slice(0, cap) as string[]
    if (list.length === 0) return Promise.resolve()
    const all = Promise.all(
      list.map(
        (u) =>
          new Promise<void>((res) => {
            const im = new window.Image()
            // onload fires when the bytes have ARRIVED, not when the browser can
            // paint them — which is why the grid used to appear with pictures
            // still resolving. decode() waits for paint-ready, so the reveal is
            // genuinely complete. It rejects on a decode failure; either way the
            // image is done being waited on.
            const done = () => res()
            im.onload = () => { (im.decode ? im.decode() : Promise.resolve()).then(done, done) }
            im.onerror = done
            im.src = u
          }),
      ),
    ).then(() => undefined)
    // The cap keeps the wait to one screenful; the timeout is the backstop so a
    // slow CDN can never strand someone on the hanger. Longer than before —
    // cutting off at 5s was itself revealing half-loaded grids on mobile data.
    return Promise.race([all, new Promise<void>((res) => setTimeout(res, timeoutMs))])
  }

  // ── Occasion fetch ─────────────────────────────────────────
  const fetchOutfits = useCallback(async (tag: string, currentOffset: number, append: boolean) => {
    if (injectedOutfits) {
      // Compute the full ordered list once (at offset 0); paginate from the ref.
      if (currentOffset === 0) {
        if (tag === NEW_TAG) {
          // NEW OUTFITS → the latest additions, newest first by created_at
          // (published_at can be null / bulk-set, so it isn't reliable here).
          const newestFirst = [...injectedOutfits].sort(byNewest)
          occOrderedRef.current = dedupeByAnchor(newestFirst).slice(0, LATEST_COUNT)
        } else {
          const matchTags = occasionMatchTags(tag)
          const filtered = tag && tag !== 'all'
            ? injectedOutfits.filter((o) => (o.occasion_tags ?? []).some((t) => matchTags.includes(t)))
            : injectedOutfits
          // One outfit per anchor — variants stay in Similar/Explore — taste-ranked
          // inside the occasion gate, then rotated by visit count so each RETURN
          // leads with different looks (the "feels alive" effect).
          const ranked = orderForFeed(dedupeByAnchor(filtered))
          occOrderedRef.current = rotateByVisit(ranked, tag)
        }
      }
      const ordered = occOrderedRef.current
      const end = currentOffset + LIMIT
      const page = ordered.slice(0, end)
      setOutfits(page)
      setHasMore(ordered.length > end)
      setLoading(false)
      setLoadingMore(false)
      if (!append) {
        await preloadImages(page.map((o) => o.image_url))
        setPreparing(false)
      }
      return
    }

    const supabase = createClient()
    if (currentOffset === 0) setLoading(true)
    else setLoadingMore(true)

    let query = supabase
      .from('outfit')
      .select(`*, outfit_item(*, item(*, brand(*)))`)
      .eq('status', 'live')
      .order('published_at', { ascending: false })
      .range(currentOffset, currentOffset + LIMIT - 1)

    if (tag && tag !== 'all') {
      // Match any of the occasion's alias tags (e.g. "summer office" also matches "office").
      query = query.overlaps('occasion_tags', occasionMatchTags(tag))
    }

    const { data, error } = await query
    let fetched: OutfitWithItems[] = []
    if (!error && data) {
      const typed = data as OutfitWithItems[]
      fetched = typed
      // De-dupe by anchor across pages so the same hero piece isn't repeated.
      setOutfits((prev) => dedupeByAnchor(append ? [...prev, ...typed] : typed))
      setHasMore(data.length === LIMIT)
    }
    setLoading(false)
    setLoadingMore(false)
    if (!append) {
      await preloadImages(fetched.map((o) => o.image_url))
      setPreparing(false)
    }
  }, [injectedOutfits])

  useEffect(() => {
    if (!occasion) return
    // Attribute the occasion view to the referral source (if any).
    void recordLandingEvent('occasion_click', occasion, getStoredRef())
    setPreparing(true)
    setOffset(0)
    setHasMore(true)
    fetchOutfits(occasion, 0, false)
  }, [occasion, fetchOutfits])

  useEffect(() => {
    if (!loadMoreRef.current || !occasion) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          const nextOffset = offset + LIMIT
          setOffset(nextOffset)
          fetchOutfits(occasion, nextOffset, true)
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [occasion, hasMore, loadingMore, loading, offset, fetchOutfits])

  // ── Search execution ───────────────────────────────────────
  const hasActiveSearch = searchQuery.trim() || filterColour || filterItemGroup || filterBrand.trim()

  const executeSearch = useCallback(async () => {
    if (!hasActiveSearch) return
    setSearchLoading(true)
    setPreparing(true)
    setSearchMode(true)
    setFilterPanel(null)

    let allOutfits: OutfitWithItems[]

    if (injectedOutfits) {
      allOutfits = injectedOutfits
    } else {
      const supabase = createClient()
      const { data } = await supabase
        .from('outfit')
        .select(`*, outfit_item(*, item(*, brand(*)))`)
        .eq('status', 'live')
        .order('published_at', { ascending: false })
        .limit(200)
      allOutfits = (data as OutfitWithItems[]) ?? []
    }

    const itemTypes = filterItemGroup
      ? ITEM_GROUPS.find(g => g.label === filterItemGroup)?.types ?? null
      : null

    // Brand names present in the catalogue — longest first so multi-word brands
    // (e.g. "veronica beard") are matched before any single-word subset.
    const brandSet = new Set<string>()
    for (const o of allOutfits) {
      for (const oi of (o.outfit_item ?? [])) {
        const n = (oi as any).item?.brand?.name
        if (n) brandSet.add(String(n).toLowerCase())
      }
    }
    const knownBrands = [...brandSet].sort((a, b) => b.length - a.length)

    // 1. HARD filters — the explicit chips (colour / item group / brand). These
    //    are deliberate user choices, so they're applied strictly.
    const pool = allOutfits.filter(o =>
      matchesSearch(o, '', filterColour, itemTypes, filterBrand, knownBrands)
    )

    // 2. Free-text query → understand it (synonyms, typos, intent) and score the
    //    pool so the result is relevant and NEVER empty (spec §7 fallback).
    let finalOutfits: OutfitWithItems[]
    let matchCount: number
    if (searchQuery.trim()) {
      const parsed = parseQuery(searchQuery, knownBrands)
      const res = searchOutfits(pool, parsed, orderForFeed)
      finalOutfits = res.outfits
      matchCount = res.matchCount
    } else {
      finalOutfits = orderForFeed(pool)
      matchCount = pool.length
    }

    // If a typed query matched nothing genuinely, we still show closest looks —
    // but flag it so the UI is honest ("no exact matches") rather than implying
    // these ARE what was asked for.
    setSearchRelaxed(!!searchQuery.trim() && matchCount === 0)
    // Log the query with how many outfits GENUINELY matched (0 = a real content gap).
    if (searchQuery.trim()) void recordSearchQuery(searchQuery, getStoredRef(), matchCount)
    setSearchResults(finalOutfits)
    setSearchLoading(false)
    await preloadImages(finalOutfits.map((o) => o.image_url))
    setPreparing(false)
  }, [hasActiveSearch, injectedOutfits, searchQuery, filterColour, filterItemGroup, filterBrand])

  function clearSearch() {
    setSearchMode(false)
    setSearchResults([])
    setSearchRelaxed(false)
    setSearchQuery('')
    setFilterColour(null)
    setFilterItemGroup(null)
    setFilterBrand('')
    setFilterPanel(null)
  }

  // ── Restore the feed view from the URL, and keep the URL in sync ──────────
  // So that when you open an outfit and press BACK, you land back on the
  // occasion / new-outfits / search you were in — not the landing page.
  const restoredRef = useRef(false)
  const [restoreSearchPending, setRestoreSearchPending] = useState(false)

  // On mount: rebuild the view the URL describes (?occasion= / ?view=new / ?q=).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const view = p.get('view')
    const occ = p.get('occasion')
    const q = p.get('q')
    if (view === 'new') setOccasion(NEW_TAG)
    else if (view === 'recs') setRecsView(true)
    else if (occ) setOccasion(occ)
    else if (q) { setSearchQuery(q); setRestoreSearchPending(true) }
    restoredRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Run the restored text search once its query has landed in state.
  useEffect(() => {
    if (restoreSearchPending && searchQuery) {
      setRestoreSearchPending(false)
      void executeSearch()
    }
  }, [restoreSearchPending, searchQuery, executeSearch])

  // Reflect the current view in the URL (shallow — no server round-trip), so the
  // browser restores it on BACK. Occasion picker / brand view → clean path.
  useEffect(() => {
    if (!restoredRef.current) return
    const params = new URLSearchParams()
    if (searchMode && searchQuery.trim()) params.set('q', searchQuery.trim())
    else if (occasion === NEW_TAG) params.set('view', 'new')
    else if (occasion) params.set('occasion', occasion)
    else if (recsView) params.set('view', 'recs')
    const qs = params.toString()
    window.history.replaceState(window.history.state, '', qs ? `?${qs}` : window.location.pathname)
  }, [occasion, searchMode, searchQuery, brandView, recsView])

  // ── Handlers ───────────────────────────────────────────────
  // Soft taste signals (+1) — fire-and-forget when the user is signed in.
  const signal = (outfitId: string, type: 'style_tap' | 'similar_tap' | 'explore_tap') => {
    if (canSave) void recordTasteInteraction(outfitId, type, occasion ?? undefined)
  }
  const handleStyleItem    = (itemId: string, itemType: ItemType, outfit: OutfitWithItems) => {
    signal(outfit.outfit_id, 'style_tap')
    router.push(`${detailHrefBase}/${outfit.outfit_id}?styleItem=${itemId}&itemType=${itemType}`)
  }
  const handleSimilarLooks = (outfit: OutfitWithItems) => {
    signal(outfit.outfit_id, 'similar_tap')
    router.push(`${detailHrefBase}/${outfit.outfit_id}?mode=similar`)
  }
  const handleExploreStyles = (outfit: OutfitWithItems) => {
    signal(outfit.outfit_id, 'explore_tap')
    router.push(`${detailHrefBase}/${outfit.outfit_id}?mode=explore`)
  }

  // Pictures for the occasion polaroids, resolved in ONE pass so each tile
  // claims a different look — computing this per tile restarts the used-set
  // every time and lets the same outfit land on two tiles.
  // Padded from the candidate pool so the reference box is always a full 3×2.
  const occasionTags = useMemo(() => {
    const base = occasionOrder && occasionOrder.length ? occasionOrder : BASE_OCCASIONS
    const padded = [...base]
    for (const tag of CANDIDATE_OCCASIONS) {
      if (padded.length >= OCCASION_GRID_COUNT) break
      if (!padded.includes(tag)) padded.push(tag)
    }
    return padded.slice(0, OCCASION_GRID_COUNT)
  }, [occasionOrder])
  const occLooks = useMemo(
    () => occasionLooks(injectedOutfits ?? [], occasionTags, occasionMatchTags),
    [injectedOutfits, occasionTags],
  )

  // ── Active filter label ────────────────────────────────────
  function activeFilterLabel(): string {
    const parts: string[] = []
    if (filterColour) parts.push(COLOUR_OPTIONS.find(c => c.value === filterColour)?.label ?? filterColour.toUpperCase())
    if (filterItemGroup) parts.push(filterItemGroup)
    if (filterBrand.trim()) parts.push(filterBrand.toUpperCase())
    if (searchQuery.trim()) parts.push(searchQuery.toUpperCase())
    return parts.join(' · ') || 'SEARCH RESULTS'
  }

  // ── View tabs (signed-in only): THE ARCHIVE / OUR RECOMMENDATIONS ─────────
  const viewTabs = canSave ? (
    <div className="flex items-center justify-center gap-8 md:gap-12">
      {([
        { label: 'THE ARCHIVE', active: !recsView, go: () => setRecsView(false) },
        { label: 'OUR RECOMMENDATIONS', active: recsView, go: () => setRecsView(true) },
      ] as const).map((t) => (
        <button
          key={t.label}
          onClick={() => { t.go(); scrollTo(0, { immediate: true }) }}
          className={`pb-2 text-[13px] md:text-[15px] tracking-[0.14em] border-b-2 transition-colors ${
            t.active ? 'border-[#111111] text-[#4A4E57]' : 'border-transparent text-[#55524C] hover:text-[#4A4E57]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  ) : null

  // ── OUR RECOMMENDATIONS VIEW ──────────────────────────────
  if (recsView && !occasion && !searchMode && !brandView) {
    const recs = recommendedOutfits.filter(fitsSize).slice(0, 9)
    return (
      <div className="w-full px-6 sm:px-10 py-14">
        <div className="mb-12">{viewTabs}</div>

        <div className="max-w-[1100px] mx-auto">
          <div className="flex items-baseline justify-between mb-4">
            <p className="myra-section-label inline-flex items-center gap-2">
              <span className="text-[#C8302A]" aria-hidden>♥</span>
              OUR RECOMMENDATIONS
            </p>
            <p className="myra-section-note">LEARNED FROM WHAT YOU LIKE</p>
          </div>

          {/* The picks as a 3×3 contact grid — same flat treatment as the
              occasion grid on the archive tab. */}
          <div className="grid grid-cols-3 gap-[6px]">
            {recs.map((o) => (
              <button
                key={o.outfit_id}
                onClick={() => router.push(`${detailHrefBase}/${o.outfit_id}`)}
                aria-label={o.aesthetic_label ?? 'View outfit'}
                className="group relative aspect-[3/4] overflow-hidden bg-[#EDEDED]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={o.image_url ? thumbUrl(o.image_url, 700) : '/placeholder-outfit.jpg'}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 group-hover:opacity-85"
                />
              </button>
            ))}
          </div>
          {recs.length === 0 && (
            <p className="myra-field py-16 text-center opacity-60">
              LIKE A FEW LOOKS AND YOUR RECOMMENDATIONS WILL APPEAR HERE
            </p>
          )}

          {/* The houses she engages with, beneath the picks. */}
          {brandRows.length > 0 && (
            <div className="mt-16">
              <div className="flex items-baseline justify-between mb-4">
                <p className="myra-section-label">BRANDS YOU LIKE</p>
                <p className="myra-section-note">HOUSES YOU LOVE</p>
              </div>
              <div data-lenis-prevent className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
                {brandRows.map((row) => (
                  <button
                    key={row.brand}
                    onClick={() => { setRecsView(false); setBrandView(row); scrollTo(0, { immediate: true }) }}
                    className="group shrink-0 w-[15vw] min-w-[170px] text-left"
                  >
                    <BrandLogoTile brand={row.brand} logoUrl={row.logo_url ?? brandLogo(row.brand)} />
                    <p className="text-[8px] tracking-[0.09em] text-[#4A4E57] mt-2">{row.outfits.length} LOOKS →</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── LANDING VIEW ──────────────────────────────────────────
  if (!occasion && !searchMode && !brandView) {
    return (
      <div className="w-full px-6 sm:px-10 py-16 flex flex-col">
        {viewTabs && <div className="order-0 mb-10">{viewTabs}</div>}
        <div className="order-1 text-center mb-10">
          {/* Stylist lens — a free, instant filter over the shared catalogue.
              Hidden until there's more than one live stylist. */}
          {stylists.length > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
              <button
                onClick={() => setStylistFilter(null)}
                className={`px-4 py-1.5 text-[9px] tracking-[0.12em] rounded-full border transition-colors ${
                  stylistFilter === null ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#4A4E57] border-[#E2E0DB] hover:border-[#0A0A0A]'
                }`}
              >
                ALL STYLISTS
              </button>
              {stylists.map((s) => (
                <button
                  key={s.stylist_id}
                  onClick={() => setStylistFilter(stylistFilter === s.stylist_id ? null : s.stylist_id)}
                  className={`px-4 py-1.5 text-[9px] tracking-[0.12em] rounded-full border transition-colors ${
                    stylistFilter === s.stylist_id ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#4A4E57] border-[#E2E0DB] hover:border-[#0A0A0A]'
                  }`}
                >
                  STYLED BY {s.name.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New Arrivals — rotating live looks at varied sizes. Sits directly
            beneath the occasions for everyone, and beneath the taste
            recommendations (order-7) for signed-in users. */}
        <NewArrivals
          outfits={injectedOutfits ?? []}
          hrefBase={detailHrefBase}
          onExplore={() => { setOccasion(NEW_TAG); scrollTo(0, { immediate: true }) }}
          className="order-8 w-full mb-12"
        />

        {/* OUR PICKS — landing page only, directly beneath the New Outfits row.
            NOTE (other sessions): please keep this block + the ourPicks prop —
            it has been removed by concurrent edits three times. */}
        {ourPicks && (
          <div className="order-8 w-full">
            <OurPicks data={ourPicks} />
          </div>
        )}

        {/* Recently viewed as a rail, directly under OUR PICKS. Local-only, so
            it works signed out. Recommendations (and the liked-brand logos)
            live on the OUR RECOMMENDATIONS tab now, not the landing. */}
        <TasteDecks
          recommended={[]}
          catalogue={injectedOutfits ?? []}
          detailHrefBase={detailHrefBase}
          className="order-9 w-full mt-4 mb-16"
        />

        {showAllOption && (
          <div className="order-5 mx-auto mb-6 text-center">
            <button
              onClick={() => setOccasion('all')}
              className="py-2 text-[11px] tracking-[0.12em] text-[#4A4E57] underline underline-offset-[6px] decoration-[#D8D6D1] hover:decoration-[#0A0A0A] transition-colors"
            >
              ↓ VIEW EVERYTHING LIVE
            </button>
          </div>
        )}

        {/* Search + filter area */}
        <div className="order-3 mb-14 -mx-6 sm:-mx-10 px-2 sm:px-10">

          {/* The card: the query written onto the set wall. Each filter writes
              its value into the box beside its label, so the whole search
              reads back as one filled-in record. */}
          <ArchiveCard
            className="mb-6 w-full"
            heading={
              <h1 className="text-center text-[clamp(30px,5vw,86px)] tracking-[0.045em] text-[#4A4E57] leading-[1.05]">
                WHAT ARE YOU DRESSING FOR?
              </h1>
            }
          >
            {/* Search bar — a single bordered rectangle, centred and narrower
                than the card, with its printed label on the left the same way
                the filter boxes carry theirs. */}
            <div className="mx-auto w-full max-w-[760px] flex items-center justify-center gap-3 mb-5 md:mb-7">
              <span className="myra-field shrink-0 text-[#55524C]">SEARCH A LOOK</span>
              <form
                onSubmit={(e) => { e.preventDefault(); executeSearch() }}
                className="flex-1 min-w-0 max-w-[620px] border border-[#2B2B2B] flex items-center"
              >
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={typedHint ? `${typedHint}▌` : 'A SUMMER WEDDING IN ITALY'}
                  className="myra-field flex-1 min-w-0 bg-transparent border-0 px-4 md:px-6 py-3.5 md:py-4 placeholder:text-[#6E6B65] focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Search"
                  className="shrink-0 px-3 md:px-5 self-stretch border-l border-[#2B2B2B] hover:bg-[rgba(255,255,255,0.25)] transition-colors"
                >
                  <svg viewBox="0 0 40 40" className="w-[16px] md:w-[20px]" aria-hidden>
                    <circle cx="17" cy="16" r="10" fill="none" stroke="#4A4E57" strokeWidth="3.2" />
                    <path d="M24.5 24 L33 33" stroke="#4A4E57" strokeWidth="3.2" strokeLinecap="round" />
                  </svg>
                </button>
              </form>
            </div>

            {/* Filter bar — printed label + bordered dropdown box per filter,
                in one row (wrapping to a 2-col grid on mobile). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap md:items-center md:justify-center gap-x-8 gap-y-3 mb-5 md:mb-7">
              <FilterBox
                label="BRAND"
                placeholder="ALL BRANDS"
                open={filterPanel === 'brand'}
                value={filterBrand.trim() ? filterBrand.toUpperCase() : null}
                onClick={() => setFilterPanel(filterPanel === 'brand' ? null : 'brand')}
              />
              <FilterBox
                label="COLOUR"
                placeholder="ALL COLOURS"
                open={filterPanel === 'colour'}
                value={filterColour ? (COLOUR_OPTIONS.find((c) => c.value === filterColour)?.label ?? null) : null}
                onClick={() => setFilterPanel(filterPanel === 'colour' ? null : 'colour')}
              />
              <FilterBox
                label="ITEM TYPE"
                placeholder="ALL TYPES"
                open={filterPanel === 'item'}
                value={filterItemGroup}
                onClick={() => setFilterPanel(filterPanel === 'item' ? null : 'item')}
              />
              <div className="flex items-center gap-3 min-w-0">
                <span className="myra-field shrink-0 text-[#55524C]">SIZE</span>
                <div className="flex-1 md:flex-none md:w-[180px] min-w-0">
                  <SizeFilter value={sizeUk} onChange={setSizeUk} box />
                </div>
              </div>
            </div>

            {/* The panels stay part of the same document as the card: square
                corners, the same hairline rule, no pills and no float. */}
            {filterPanel === 'colour' && (
              <div className="border border-[#2B2B2B] bg-[#C5C0B8] px-4 md:px-6 py-5 mb-5 md:mb-7">
                {/* Small fixed-size chips rather than a fluid grid — the panel
                    should read as a row of paint samples, not a colour chart. */}
                <div className="flex flex-wrap justify-center gap-x-5 gap-y-4">
                  {COLOUR_OPTIONS.map((c) => {
                    const on = filterColour === c.value
                    return (
                      <button
                        key={c.value}
                        onClick={() => { setFilterColour(on ? null : c.value); setFilterPanel(null) }}
                        className="group flex flex-col items-center gap-1.5"
                      >
                        {/* The colour does the talking; the name sits under it. */}
                        <span
                          className={`block w-[38px] h-[38px] md:w-[46px] md:h-[46px] border transition-all ${
                            on ? 'border-[#2B2B2B] ring-1 ring-[#2B2B2B] ring-offset-2 ring-offset-[#C5C0B8]' : 'border-[#D8D6D1] group-hover:border-[#2B2B2B]'
                          }`}
                          style={{ background: c.swatch }}
                        />
                        <span className="myra-field">
                          {c.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {filterPanel === 'item' && (
              <div className="border border-[#2B2B2B] bg-[#C5C0B8] mb-5 md:mb-7 overflow-hidden">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 -mr-px -mb-px">
                  {ITEM_GROUPS.map((g) => {
                    const on = filterItemGroup === g.label
                    return (
                      <button
                        key={g.label}
                        onClick={() => { setFilterItemGroup(on ? null : g.label); setFilterPanel(null) }}
                        className={`myra-field px-4 py-5 border-r border-b border-[#2B2B2B] transition-colors ${
                          on ? 'bg-[#2B2B2B] text-white' : 'text-[#4A4E57] hover:bg-[#F1F0EC]'
                        }`}
                      >
                        {g.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {filterPanel === 'brand' && (
              <div className="border border-[#2B2B2B] bg-[#C5C0B8] px-4 md:px-6 py-6 mb-5 md:mb-7">
                <div className="flex items-center gap-4">
                  <input
                    type="text"
                    value={filterBrand}
                    onChange={(e) => setFilterBrand(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setFilterPanel(null) } }}
                    placeholder="E.G. STAUD, TOTEME, JACQUEMUS…"
                    autoFocus
                    className="myra-field flex-1 min-w-0 border border-[#2B2B2B] bg-transparent px-4 py-3 placeholder:text-[#B4B4AE] focus:outline-none"
                  />
                  <button
                    onClick={() => setFilterPanel(null)}
                    className="shrink-0 border border-[#2B2B2B] px-6 py-3 text-[10px] md:text-[12px] tracking-[0.16em] text-[#4A4E57] hover:bg-[#2B2B2B] hover:text-white transition-colors"
                  >
                    DONE
                  </button>
                </div>
              </div>
            )}

            {/* Occasion grid — a 3-across contact grid, each occasion shown
                through a live look with its name in white at the centre.
                Borderless: the tiles sit straight on the set-wall grey.
                Tapping one opens that occasion's feed. */}
            <div>
              <div className="grid grid-cols-3 gap-[6px]">
                {occasionTags.slice(0, OCCASION_GRID_COUNT).map((tag) => {
                  const look = occLooks[tag]
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setOccasion(tag)}
                      className="group relative w-full aspect-[3/4] overflow-hidden bg-[#E4E2DD]"
                    >
                      {look?.image_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={thumbUrl(look.image_url, 700)}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 group-hover:opacity-85"
                        />
                      ) : null}
                      {/* Soft scrim so the white label holds on pale looks. */}
                      <span className="absolute inset-0 bg-[rgba(0,0,0,0.18)]" aria-hidden />
                      <span className="absolute inset-0 flex items-center justify-center px-3 md:px-6 text-center text-white text-[19px] md:text-[34px] tracking-[0.14em] leading-[1.2] drop-shadow-[0_1px_8px_rgba(0,0,0,0.5)]">
                        {occasionLabel(tag)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </ArchiveCard>
        </div>
      </div>
    )
  }

  // ── BRAND DISCOVERY VIEW ──────────────────────────────────
  if (brandView) {
    return (
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-[11px] tracking-[0.113em] text-[#4A4E57] mb-1">DISCOVER</p>
            <h2 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">{brandView.label}</h2>
          </div>
          <button
            onClick={() => setBrandView(null)}
            className="text-[11px] tracking-[0.09em] text-[#4A4E57] border border-[#E2E0DB] px-5 py-2.5 rounded-[12px] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-all duration-300"
          >
            CLOSE
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-0 -mx-6 sm:-mx-10">
          {brandView.outfits.filter(fitsSize).map((outfit, i) => (
            <OutfitCard
              key={outfit.outfit_id}
              outfit={outfit}
              detailHref={`${detailHrefBase}/${outfit.outfit_id}`}
              onSimilarLooks={handleSimilarLooks}
              onExploreStyles={handleExploreStyles}
              onStyleItem={handleStyleItem}
              canSave={canSave}
              initialSaved={savedSet.has(outfit.outfit_id)}
              lockedSave={lockedSave}
            />
          ))}
        </div>
      </div>
    )
  }

  // ── SEARCH RESULTS VIEW ───────────────────────────────────
  if (searchMode) {
    return (
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-[11px] tracking-[0.113em] text-[#4A4E57] mb-1">SEARCH</p>
            <h2 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">{activeFilterLabel()}</h2>
          </div>
          <div className="flex items-center gap-2">
            <SizeFilter value={sizeUk} onChange={setSizeUk} compact />
            <button
              onClick={clearSearch}
              className="text-[11px] tracking-[0.09em] text-[#4A4E57] border border-[#E2E0DB] px-5 py-2.5 rounded-full hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-all duration-300"
            >
              CLEAR
            </button>
          </div>
        </div>

        {/* Docked at the foot of the screen now that results are on show —
            the same archive rule and label as the card on the landing page,
            shortened to one line. */}
        <div className="myra-search-dock">
          <form
            onSubmit={(e) => { e.preventDefault(); executeSearch() }}
            className="flex items-stretch border border-[#2B2B2B] bg-[#C5C0B8] shadow-[0_10px_34px_rgba(0,0,0,0.16)]"
          >
            <div className="shrink-0 border-r border-[#2B2B2B] flex items-end px-3 md:px-5 pb-2 pt-4">
              <span className="myra-field whitespace-nowrap">LOOKING FOR</span>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="A SUMMER WEDDING IN ITALY"
              className="flex-1 min-w-0 bg-transparent border-0 px-4 md:px-6 py-4 md:py-5 myra-field placeholder:opacity-45 focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Search"
              className="shrink-0 px-5 md:px-7 border-l border-[#2B2B2B] hover:bg-[#F4F3F0] transition-colors"
            >
              <svg viewBox="0 0 40 40" className="w-[20px] md:w-[24px]" aria-hidden>
                <circle cx="17" cy="16" r="10" fill="none" stroke="#4A4E57" strokeWidth="3.2" />
                <path d="M24.5 24 L33 33" stroke="#4A4E57" strokeWidth="3.2" strokeLinecap="round" />
              </svg>
            </button>
          </form>
        </div>

        {!searchLoading && !preparing && searchResults.length === 0 && (
          <div className="text-center py-24">
            <p className="text-[11px] tracking-[0.113em] text-[#4A4E57] mb-6">NO OUTFITS FOUND</p>
            <button
              onClick={clearSearch}
              className="border border-[#0A0A0A] text-[#4A4E57] px-8 py-3 rounded-[12px] text-[11px] tracking-[0.09em] hover:bg-[#0A0A0A] hover:text-white transition-all duration-400"
            >
              TRY ANOTHER SEARCH
            </button>
          </div>
        )}

        {!searchLoading && !preparing && searchRelaxed && searchResults.length > 0 && (
          <p className="text-[11px] tracking-[0.06em] text-[#4A4E57] mb-6 -mt-2">
            Here are the closest looks.
          </p>
        )}

        {!searchLoading && !preparing && searchResults.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 -mx-6 sm:-mx-10">
            {searchResults.filter(fitsSize).map((outfit, i) => (
              <div
                key={outfit.outfit_id}
                className="myra-rise"
                // Capped so the tail of a long grid isn't left waiting.
                style={{ animationDelay: `${Math.min(i, 11) * 55}ms` }}
              >
                <OutfitCard
                  outfit={outfit}
                  detailHref={`${detailHrefBase}/${outfit.outfit_id}`}
                  onSimilarLooks={handleSimilarLooks}
                  onExploreStyles={handleExploreStyles}
                  onStyleItem={handleStyleItem}
                  canSave={canSave}
                  initialSaved={savedSet.has(outfit.outfit_id)}
                  lockedSave={lockedSave}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── OCCASION FEED VIEW ────────────────────────────────────
  return (
    <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[11px] tracking-[0.113em] text-[#4A4E57] mb-1">
            {occasion === NEW_TAG ? 'LATEST' : 'YOUR OCCASION'}
          </p>
          <h2 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">
            {occasion === 'all'
              ? 'EVERYTHING LIVE'
              : occasion === NEW_TAG
                ? 'NEW OUTFITS'
                : occasion!.toUpperCase()}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <SizeFilter value={sizeUk} onChange={setSizeUk} compact />
          <button
            onClick={() => setOccasion(null)}
            className="text-[11px] tracking-[0.09em] text-[#4A4E57] border border-[#E2E0DB] px-5 py-2.5 rounded-full hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-all duration-300"
          >
            CHANGE
          </button>
        </div>
      </div>

      {/* Docked at the foot of the screen now that results are on show —
          the same archive rule and label as the card on the landing page,
          shortened to one line. */}
      <div className="myra-search-dock">
        <form
          onSubmit={(e) => { e.preventDefault(); executeSearch() }}
          className="flex items-stretch border border-[#2B2B2B] bg-[#C5C0B8] shadow-[0_10px_34px_rgba(0,0,0,0.16)]"
        >
          <div className="shrink-0 border-r border-[#2B2B2B] flex items-end px-3 md:px-5 pb-2 pt-4">
            <span className="myra-field whitespace-nowrap">LOOKING FOR</span>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="A SUMMER WEDDING IN ITALY"
            className="flex-1 min-w-0 bg-transparent border-0 px-4 md:px-6 py-4 md:py-5 myra-field placeholder:opacity-45 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Search"
            className="shrink-0 px-5 md:px-7 border-l border-[#2B2B2B] hover:bg-[#F4F3F0] transition-colors"
          >
            <svg viewBox="0 0 40 40" className="w-[20px] md:w-[24px]" aria-hidden>
              <circle cx="17" cy="16" r="10" fill="none" stroke="#4A4E57" strokeWidth="3.2" />
              <path d="M24.5 24 L33 33" stroke="#4A4E57" strokeWidth="3.2" strokeLinecap="round" />
            </svg>
          </button>
        </form>
      </div>

      {!loading && !preparing && outfits.length === 0 && (
        <div className="text-center py-24">
          <p className="text-[11px] tracking-[0.113em] text-[#4A4E57] mb-6">NO OUTFITS YET FOR THIS OCCASION</p>
          <button
            onClick={() => setOccasion(null)}
            className="border border-[#0A0A0A] text-[#4A4E57] px-8 py-3 rounded-[12px] text-[11px] tracking-[0.09em] hover:bg-[#0A0A0A] hover:text-white transition-all duration-400"
          >
            TRY ANOTHER OCCASION
          </button>
        </div>
      )}

      {!loading && !preparing && outfits.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 -mx-6 sm:-mx-10">
            {outfits.filter(fitsSize).map((outfit, i) => (
              <div
                key={outfit.outfit_id}
                className="myra-rise"
                // Capped so the tail of a long grid isn't left waiting.
                style={{ animationDelay: `${Math.min(i, 11) * 55}ms` }}
              >
              <OutfitCard
                outfit={outfit}
                detailHref={`${detailHrefBase}/${outfit.outfit_id}`}
                onSimilarLooks={handleSimilarLooks}
                onExploreStyles={handleExploreStyles}
                onStyleItem={handleStyleItem}
                canSave={canSave}
                initialSaved={savedSet.has(outfit.outfit_id)}
                lockedSave={lockedSave}
              />
              </div>
            ))}
          </div>

          <div ref={loadMoreRef} className="py-8 flex justify-center">
            {loadingMore && (
              <div className="flex gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#A8A8A4] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#A8A8A4] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#A8A8A4] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
            {!hasMore && !loadingMore && outfits.length > 0 && (
              <p className="text-[10px] tracking-[0.113em] text-[#4A4E57]">END OF EDIT</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

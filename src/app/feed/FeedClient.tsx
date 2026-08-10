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
import { parseQuery, searchOutfits } from '@/lib/search-taxonomy'
import FallbackImage from '@/components/FallbackImage'
import { brandLogo } from '@/lib/brand-logos'
import BrandLogoTile from '@/components/BrandLogoTile'
import NewArrivals, { byNewest } from '@/components/NewArrivals'
import OurPicks from '@/components/OurPicks'
import TasteDecks from '@/components/TasteDecks'
import TornPaper from '@/components/TornPaper'
import DrawnSearchFrame from '@/components/DrawnSearchFrame'
import { ArchiveCard, ArchiveRow, ArchiveCell } from '@/components/ArchiveCard'
import PolaroidOccasion, { occasionImages } from '@/components/PolaroidOccasion'
import HangerLoader from '@/components/HangerLoader'
import SizeFilter from './SizeFilter'
import { outfitFitsClothingUk } from '@/lib/sizing'
import { occasionLabel, BASE_OCCASIONS, occasionMatchTags } from '@/lib/occasions'
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

    // Wait for the first screenful of images to actually decode, so the grid can
  // be revealed complete and sharp instead of filling in tile by tile. Capped in
  // both count and time — a slow CDN must never strand someone on the loader.
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
    const qs = params.toString()
    window.history.replaceState(window.history.state, '', qs ? `?${qs}` : window.location.pathname)
  }, [occasion, searchMode, searchQuery, brandView])

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
  const occasionTags = occasionOrder && occasionOrder.length ? occasionOrder : BASE_OCCASIONS
  const occPictures = useMemo(
    () => occasionImages(injectedOutfits ?? [], occasionTags, occasionMatchTags),
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

  // ── LANDING VIEW ──────────────────────────────────────────
  if (!occasion && !searchMode && !brandView) {
    return (
      <div className="w-full px-6 sm:px-10 py-16 flex flex-col">
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
          onExplore={() => { setOccasion(NEW_TAG); window.scrollTo({ top: 0 }) }}
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

        {/* Taste + history as fanning card decks, directly under OUR PICKS.
            Recently viewed is local-only, so it works signed out. */}
        <TasteDecks
          recommended={recommendedOutfits}
          catalogue={injectedOutfits ?? []}
          detailHrefBase={detailHrefBase}
          className="order-9 w-full mt-4 mb-16"
        />

        {/* Discover more from the houses she loves — a row of brand tiles, each a
            2×2 collage; tap one to open that brand's scrolling feed. */}
        {brandRows.length > 0 && (
          <div className="order-10 w-full mb-12">
            <div className="flex items-baseline justify-between mb-4">
              <p className="myra-section-label">DISCOVER MORE FROM BRANDS YOU LIKE</p>
              <p className="myra-section-note">HOUSES YOU LOVE</p>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
              {brandRows.map((row) => (
                <button
                  key={row.brand}
                  onClick={() => { setBrandView(row); window.scrollTo({ top: 0 }) }}
                  className="group shrink-0 w-[15vw] min-w-[170px] text-left"
                >
                  {/* Brand logo (falls back to a wordmark) */}
                  <BrandLogoTile brand={row.brand} logoUrl={row.logo_url ?? brandLogo(row.brand)} />
                  <p className="text-[8px] tracking-[0.09em] text-[#4A4E57] mt-2">{row.outfits.length} LOOKS →</p>
                </button>
              ))}
            </div>
          </div>
        )}

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

        {/* Occasions — instant prints, each showing a look actually tagged
            with that occasion, caption on the polaroid's deep bottom lip.
            Tilts come from the index so they stay put across renders. */}
        <div className="order-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-7 md:gap-10 w-full mb-20 -mx-6 sm:-mx-10 px-6 sm:px-10">
          {occasionTags.map((tag, i) => (
            <PolaroidOccasion
              key={tag}
              label={occasionLabel(tag)}
              image={occPictures[tag]}
              tilt={[-1.7, 1.2, -0.8, 1.9, -1.3, 1.0, -2.0, 0.7][i % 8]}
              onClick={() => setOccasion(tag)}
            />
          ))}
        </div>

        {/* Search + filter area */}
        <div className="order-3 w-full mb-14 -mx-6 sm:-mx-10 px-3 sm:px-10">

          {/* The card: the query written onto an archive index sheet. Each
              filter writes its value into the cell beside its label, so the
              whole search reads back as one filled-in record. */}
          <ArchiveCard
            className="mb-6 w-full"
            heading={
              <h1 className="text-center text-[clamp(30px,5vw,86px)] tracking-[0.045em] text-[#4A4E57] leading-[1.05]">
                WHAT ARE YOU DRESSING FOR?
              </h1>
            }
          >
            <ArchiveRow label="LOOKING FOR">
              <form onSubmit={(e) => { e.preventDefault(); executeSearch() }} className="flex items-center">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={typedHint ? `${typedHint}▌` : 'A SUMMER WEDDING IN ITALY'}
                  className="myra-field flex-1 min-w-0 bg-transparent border-0 px-4 md:px-7 py-5 md:py-7 placeholder:text-[#B4B4AE] focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Search"
                  className="shrink-0 px-4 md:px-6 self-stretch border-l border-[#2B2B2B] hover:bg-[#F4F3F0] transition-colors"
                >
                  <svg viewBox="0 0 40 40" className="w-[24px] md:w-[30px]" aria-hidden>
                    <circle cx="17" cy="16" r="10" fill="none" stroke="#4A4E57" strokeWidth="3.2" />
                    <path d="M24.5 24 L33 33" stroke="#4A4E57" strokeWidth="3.2" strokeLinecap="round" />
                  </svg>
                </button>
              </form>
            </ArchiveRow>

            {/* MOBILE — the four filters as a 2x2 block. Stacking them as
                full-width rows made the card twice as tall as the screen; a
                grid keeps the whole query visible at once. Text is a step
                smaller here (.myra-compact) because the cells are narrow. */}
            <div className="grid grid-cols-2 md:hidden myra-compact -mr-px -mb-px">
              <div className="border-r border-b border-[#2B2B2B] flex flex-col">
                <span className="myra-field px-3 pt-3">COLOUR</span>
                <ArchiveCell
                  open={filterPanel === 'colour'}
                  value={filterColour ? (COLOUR_OPTIONS.find((c) => c.value === filterColour)?.label ?? null) : null}
                  onClick={() => setFilterPanel(filterPanel === 'colour' ? null : 'colour')}
                />
              </div>
              <div className="border-r border-b border-[#2B2B2B] flex flex-col">
                <span className="myra-field px-3 pt-3">ITEM TYPE</span>
                <ArchiveCell
                  open={filterPanel === 'item'}
                  value={filterItemGroup}
                  onClick={() => setFilterPanel(filterPanel === 'item' ? null : 'item')}
                />
              </div>
              <div className="border-r border-b border-[#2B2B2B] flex flex-col">
                <span className="myra-field px-3 pt-3">BRAND</span>
                <ArchiveCell
                  open={filterPanel === 'brand'}
                  value={filterBrand.trim() ? filterBrand.toUpperCase() : null}
                  onClick={() => setFilterPanel(filterPanel === 'brand' ? null : 'brand')}
                />
              </div>
              <div className="border-r border-b border-[#2B2B2B] flex flex-col">
                <span className="myra-field px-3 pt-3">SIZE</span>
                <div className="px-3 py-4 flex items-center">
                  <SizeFilter value={sizeUk} onChange={setSizeUk} />
                </div>
              </div>
            </div>

            {/* DESKTOP — the ruled ledger rows, where there is width for them. */}
            <div className="hidden md:block">
              <ArchiveRow label="COLOUR">
                <div className="flex">
                  <div className="flex-1 min-w-0 border-r border-[#2B2B2B]">
                    <ArchiveCell
                      open={filterPanel === 'colour'}
                      value={filterColour ? (COLOUR_OPTIONS.find((c) => c.value === filterColour)?.label ?? null) : null}
                      onClick={() => setFilterPanel(filterPanel === 'colour' ? null : 'colour')}
                    />
                  </div>
                  <div className="shrink-0 w-[230px] border-r border-[#2B2B2B] flex items-end px-5 pb-3 pt-5">
                    <span className="myra-field">ITEM TYPE</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <ArchiveCell
                      open={filterPanel === 'item'}
                      value={filterItemGroup}
                      onClick={() => setFilterPanel(filterPanel === 'item' ? null : 'item')}
                    />
                  </div>
                </div>
              </ArchiveRow>

              <ArchiveRow label="BRAND" last>
                <div className="flex">
                  <div className="flex-1 min-w-0 border-r border-[#2B2B2B]">
                    <ArchiveCell
                      open={filterPanel === 'brand'}
                      value={filterBrand.trim() ? filterBrand.toUpperCase() : null}
                      onClick={() => setFilterPanel(filterPanel === 'brand' ? null : 'brand')}
                    />
                  </div>
                  <div className="shrink-0 w-[230px] border-r border-[#2B2B2B] flex items-end px-5 pb-3 pt-5">
                    <span className="myra-field">SIZE</span>
                  </div>
                  <div className="flex-1 min-w-0 px-5 py-3 flex items-center">
                    <SizeFilter value={sizeUk} onChange={setSizeUk} />
                  </div>
                </div>
              </ArchiveRow>
            </div>
          </ArchiveCard>

          {/* The panels are part of the same document as the card: square
              corners, the same hairline rule, no pills and no float. */}
          {filterPanel === 'colour' && (
            <div className="border border-[#2B2B2B] border-t-0 bg-[#FCFCFA] px-4 md:px-6 py-6 mb-6">
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-16 gap-x-4 gap-y-6">
                {COLOUR_OPTIONS.map((c) => {
                  const on = filterColour === c.value
                  return (
                    <button
                      key={c.value}
                      onClick={() => { setFilterColour(on ? null : c.value); setFilterPanel(null) }}
                      className="group flex flex-col items-center gap-2"
                    >
                      {/* The colour does the talking; the name sits under it. */}
                      <span
                        className={`block w-full aspect-square border transition-all ${
                          on ? 'border-[#2B2B2B] ring-1 ring-[#2B2B2B] ring-offset-2 ring-offset-[#FCFCFA]' : 'border-[#D8D6D1] group-hover:border-[#2B2B2B]'
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
            <div className="border border-[#2B2B2B] border-t-0 bg-[#FCFCFA] mb-6 overflow-hidden">
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
            <div className="border border-[#2B2B2B] border-t-0 bg-[#FCFCFA] px-4 md:px-6 py-6 mb-6">
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
          {brandView.outfits.filter(fitsSize).map((outfit) => (
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

        {/* The search field, docked at the foot of the screen now that results
            are on show — it slides down here from the middle of the landing
            page, and stays reachable without scrolling back up. */}
        <div className="myra-search-dock">
          <form onSubmit={(e) => { e.preventDefault(); executeSearch() }}>
            <DrawnSearchFrame onSubmit={executeSearch}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SEARCH BY STYLE, COLOUR, BRAND, MATERIAL…"
                className="w-full bg-transparent border-0 pl-6 pr-2 py-4 md:py-5 text-center text-[12px] md:text-[15px] tracking-[0.12em] text-[#4A4E57] placeholder:text-[#4A4E57] focus:outline-none"
              />
            </DrawnSearchFrame>
          </form>
        </div>

        {(searchLoading || preparing) && <HangerLoader />}

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
            {searchResults.filter(fitsSize).map((outfit) => (
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

      {/* The search field, docked at the foot of the screen now that results
          are on show — it slides down here from the middle of the landing
          page, and stays reachable without scrolling back up. */}
      <div className="myra-search-dock">
        <form onSubmit={(e) => { e.preventDefault(); executeSearch() }}>
          <DrawnSearchFrame onSubmit={executeSearch}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH BY STYLE, COLOUR, BRAND, MATERIAL…"
              className="w-full bg-transparent border-0 pl-6 pr-2 py-4 md:py-5 text-center text-[12px] md:text-[15px] tracking-[0.12em] text-[#4A4E57] placeholder:text-[#4A4E57] focus:outline-none"
            />
          </DrawnSearchFrame>
        </form>
      </div>

      {(loading || preparing) && <HangerLoader />}

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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 -mx-6 sm:-mx-10 myra-reveal">
            {outfits.filter(fitsSize).map((outfit) => (
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

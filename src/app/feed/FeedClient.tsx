'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
      setOutfits(ordered.slice(0, end))
      setHasMore(ordered.length > end)
      setLoading(false)
      setLoadingMore(false)
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
    if (!error && data) {
      const typed = data as OutfitWithItems[]
      // De-dupe by anchor across pages so the same hero piece isn't repeated.
      setOutfits((prev) => dedupeByAnchor(append ? [...prev, ...typed] : typed))
      setHasMore(data.length === LIMIT)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [injectedOutfits])

  useEffect(() => {
    if (!occasion) return
    // Attribute the occasion view to the referral source (if any).
    void recordLandingEvent('occasion_click', occasion, getStoredRef())
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
          <h1 className="text-[clamp(36px,4.6vw,84px)] tracking-[0.045em] text-[#4A4E57] leading-tight">
            WHAT ARE YOU DRESSING FOR?
          </h1>
          {/* Stylist lens — a free, instant filter over the shared catalogue.
              Hidden until there's more than one live stylist. */}
          {stylists.length > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
              <button
                onClick={() => setStylistFilter(null)}
                className={`px-4 py-1.5 text-[9px] tracking-[0.12em] rounded-full border transition-colors ${
                  stylistFilter === null ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
                }`}
              >
                ALL STYLISTS
              </button>
              {stylists.map((s) => (
                <button
                  key={s.stylist_id}
                  onClick={() => setStylistFilter(stylistFilter === s.stylist_id ? null : s.stylist_id)}
                  className={`px-4 py-1.5 text-[9px] tracking-[0.12em] rounded-full border transition-colors ${
                    stylistFilter === s.stylist_id ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
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
              <p className="text-[11px] tracking-[0.099em] text-[#4A4E57]">DISCOVER MORE FROM BRANDS YOU LIKE</p>
              <p className="text-[9px] tracking-[0.072em] text-[#A8A8A4]">HOUSES YOU LOVE</p>
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
                  <p className="text-[8px] tracking-[0.09em] text-[#A8A8A4] mt-2">{row.outfits.length} LOOKS →</p>
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

        {/* Occasions — torn scraps of paper pinned to the grey ground, each
            tilted a different way so the grid reads as a collage rather than a
            row of buttons. Tilt and tear seed come from the index, so they stay
            put across renders instead of reshuffling on every keystroke. */}
        <div className="order-6 grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8 max-w-[1100px] mx-auto mb-16 px-1">
          {(occasionOrder && occasionOrder.length ? occasionOrder : BASE_OCCASIONS).map((tag, i) => (
            <TornPaper
              key={tag}
              as="button"
              onClick={() => setOccasion(tag)}
              seed={3 + i * 7}
              rough={11}
              tilt={[-1.6, 1.1, -0.7, 1.8, -1.2, 0.9][i % 6]}
              className="group block w-full transition-transform duration-300 hover:-translate-y-[3px] hover:rotate-0"
            >
              <span className="flex items-center justify-center text-center min-h-[64px] md:min-h-[76px] px-5 md:px-7 py-4
                               text-[12px] md:text-[15px] tracking-[0.16em] md:tracking-[0.2em] leading-snug text-[#0A0A0A]">
                {occasionLabel(tag)}
              </span>
            </TornPaper>
          ))}
        </div>

        {/* Search + filter area */}
        <div className="order-3 w-full max-w-[1100px] mx-auto mb-12">

          {/* Active filter chips */}
          {(filterColour || filterItemGroup || filterBrand.trim()) && (
            <div className="flex flex-wrap gap-2 mb-3">
              {filterColour && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A0A0A] text-white text-[9px] tracking-[0.072em] rounded-[12px]">
                  {COLOUR_OPTIONS.find(c => c.value === filterColour)?.label}
                  <button onClick={() => setFilterColour(null)} className="opacity-70 hover:opacity-100 text-[11px] leading-none">×</button>
                </span>
              )}
              {filterItemGroup && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A0A0A] text-white text-[9px] tracking-[0.072em] rounded-[12px]">
                  {filterItemGroup}
                  <button onClick={() => setFilterItemGroup(null)} className="opacity-70 hover:opacity-100 text-[11px] leading-none">×</button>
                </span>
              )}
              {filterBrand.trim() && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A0A0A] text-white text-[9px] tracking-[0.072em] rounded-[12px]">
                  {filterBrand.toUpperCase()}
                  <button onClick={() => setFilterBrand('')} className="opacity-70 hover:opacity-100 text-[11px] leading-none">×</button>
                </span>
              )}
            </div>
          )}

          {/* Search — subtle underlined text field, no box, no button (Enter to search) */}
          <form
            onSubmit={(e) => { e.preventDefault(); executeSearch() }}
            className="mb-5 w-full"
          >
            {/* The field itself is transparent — the torn scrap behind it is
                the only "box", so the caret sits straight on the paper. */}
            <TornPaper seed={11} rough={14} className="w-full">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={typedHint ? `${typedHint}▌` : 'SEARCH BY STYLE, COLOUR, BRAND, MATERIAL…'}
                className="
                  w-full bg-transparent border-0
                  px-8 py-6 md:py-8
                  text-center text-[14px] md:text-[18px] tracking-[0.12em] text-[#4A4E57]
                  placeholder:text-[#A8A8A4]
                  focus:outline-none
                "
              />
            </TornPaper>
          </form>

          {/* Filter buttons — same outlined white square as the search field, so
              the whole control strip reads as one thing. */}
          <div className="flex flex-wrap gap-2 md:gap-3 mb-4 justify-center">
            {(['colour', 'item', 'brand'] as const).map((type) => {
              const isActive = filterPanel === type
              const hasValue = type === 'colour' ? !!filterColour : type === 'item' ? !!filterItemGroup : !!filterBrand.trim()
              return (
                <button
                  key={type}
                  onClick={() => setFilterPanel(isActive ? null : type)}
                  className={`
                    px-5 md:px-7 py-3.5 md:py-4 bg-white border rounded-[3px]
                    text-[11px] md:text-[13px] tracking-[0.16em] md:tracking-[0.2em]
                    transition-colors duration-300
                    ${hasValue || isActive
                      ? 'border-[#0A0A0A] text-[#0A0A0A]'
                      : 'border-[#E2E0DB] text-[#4A4E57] hover:bg-[#F2F2F2] hover:border-[#0A0A0A]'}
                  `}
                >
                  {type === 'colour' ? 'COLOUR' : type === 'item' ? 'ITEM TYPE' : 'BRAND'} {isActive ? '▲' : '▾'}
                </button>
              )
            })}
            <SizeFilter value={sizeUk} onChange={setSizeUk} />
          </div>

          {/* Colour panel */}
          {filterPanel === 'colour' && (
            <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-4 mb-4">
              <div className="flex flex-wrap gap-2">
                {COLOUR_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => { setFilterColour(filterColour === c.value ? null : c.value); setFilterPanel(null) }}
                    className={`flex items-center gap-2 px-3 py-2 text-[9px] tracking-[0.063em] rounded-[12px] border transition-colors ${
                      filterColour === c.value
                        ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                        : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-[#E2E0DB] flex-shrink-0"
                      style={{ background: c.swatch }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Item type panel */}
          {filterPanel === 'item' && (
            <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-4 mb-4">
              <div className="flex flex-wrap gap-2">
                {ITEM_GROUPS.map((g) => (
                  <button
                    key={g.label}
                    onClick={() => { setFilterItemGroup(filterItemGroup === g.label ? null : g.label); setFilterPanel(null) }}
                    className={`px-3 py-2 text-[9px] tracking-[0.063em] rounded-[12px] border transition-colors ${
                      filterItemGroup === g.label
                        ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                        : 'border-[#E2E0DB] text-[#4A4E57] hover:border-[#0A0A0A]'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Brand panel */}
          {filterPanel === 'brand' && (
            <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-4 mb-4">
              <input
                type="text"
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setFilterPanel(null) } }}
                placeholder="E.G. STAUD, TOTEME, JACQUEMUS…"
                autoFocus
                className="w-full border border-[#E2E0DB] bg-[#FAFAF8] px-4 py-2.5 text-[11px] tracking-[0.054em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors"
              />
              <button
                onClick={() => setFilterPanel(null)}
                className="mt-3 text-[9px] tracking-[0.081em] text-[#6B6B6B] hover:text-[#4A4E57]"
              >
                DONE
              </button>
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
            <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-1">DISCOVER</p>
            <h2 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">{brandView.label}</h2>
          </div>
          <button
            onClick={() => setBrandView(null)}
            className="text-[11px] tracking-[0.09em] text-[#6B6B6B] border border-[#E2E0DB] px-5 py-2.5 rounded-[12px] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-all duration-300"
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
            <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-1">SEARCH</p>
            <h2 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">{activeFilterLabel()}</h2>
          </div>
          <div className="flex items-center gap-2">
            <SizeFilter value={sizeUk} onChange={setSizeUk} compact />
            <button
              onClick={clearSearch}
              className="text-[11px] tracking-[0.09em] text-[#6B6B6B] border border-[#E2E0DB] px-5 py-2.5 rounded-full hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-all duration-300"
            >
              CLEAR
            </button>
          </div>
        </div>

        {searchLoading && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 -mx-6 sm:-mx-10">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="aspect-[3/4] bg-[#F2F2F2] animate-pulse rounded-[10px]" />
            ))}
          </div>
        )}

        {!searchLoading && searchResults.length === 0 && (
          <div className="text-center py-24">
            <p className="text-[11px] tracking-[0.113em] text-[#A8A8A4] mb-6">NO OUTFITS FOUND</p>
            <button
              onClick={clearSearch}
              className="border border-[#0A0A0A] text-[#4A4E57] px-8 py-3 rounded-[12px] text-[11px] tracking-[0.09em] hover:bg-[#0A0A0A] hover:text-white transition-all duration-400"
            >
              TRY ANOTHER SEARCH
            </button>
          </div>
        )}

        {!searchLoading && searchRelaxed && searchResults.length > 0 && (
          <p className="text-[11px] tracking-[0.06em] text-[#6B6B6B] mb-6 -mt-2">
            Here are the closest looks.
          </p>
        )}

        {!searchLoading && searchResults.length > 0 && (
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
          <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-1">
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
            className="text-[11px] tracking-[0.09em] text-[#6B6B6B] border border-[#E2E0DB] px-5 py-2.5 rounded-full hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-all duration-300"
          >
            CHANGE
          </button>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-0 -mx-6 sm:-mx-10">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="aspect-[3/4] bg-[#F2F2F2] animate-pulse rounded-[10px]" />
          ))}
        </div>
      )}

      {!loading && outfits.length === 0 && (
        <div className="text-center py-24">
          <p className="text-[11px] tracking-[0.113em] text-[#A8A8A4] mb-6">NO OUTFITS YET FOR THIS OCCASION</p>
          <button
            onClick={() => setOccasion(null)}
            className="border border-[#0A0A0A] text-[#4A4E57] px-8 py-3 rounded-[12px] text-[11px] tracking-[0.09em] hover:bg-[#0A0A0A] hover:text-white transition-all duration-400"
          >
            TRY ANOTHER OCCASION
          </button>
        </div>
      )}

      {!loading && outfits.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0 -mx-6 sm:-mx-10">
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
              <p className="text-[10px] tracking-[0.113em] text-[#A8A8A4]">END OF EDIT</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

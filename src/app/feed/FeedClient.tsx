'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import OutfitCard from '@/components/outfit-card/OutfitCard'
import SaveHeartButton from '@/components/outfit-card/SaveHeartButton'
import { createClient } from '@/lib/supabase'
import type { OutfitWithItems, ItemType, ColourFamily } from '@/types/database'

// Example occasions that "type" themselves into the search bar as a prompt.
const SEARCH_EXAMPLES = [
  'A GIRLS HOLIDAY IN MYKONOS',
  'A SUMMER WEDDING IN ITALY',
  'DINNER ON A ROOFTOP',
  'WIMBLEDON IN JULY',
  'BRUNCH WITH THE GIRLS',
  'A FIRST DATE',
  'A WEEKEND IN THE COUNTRYSIDE',
  'A BLACK LACE DRESS FOR A PARTY',
]

// ── Preset occasions ──────────────────────────────────────────
const PRESET_OCCASIONS = [
  { label: 'WEEKEND AWAY', tag: 'weekend away' },
  { label: 'WIMBLEDON', tag: 'wimbledon' },
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

// ── Outfit matching logic ─────────────────────────────────────

// Match token as a whole word so "red" doesn't match "flared", "tailored", "structured" etc.
function wordMatch(text: string | null | undefined, token: string): boolean {
  if (!text) return false
  return new RegExp(`\\b${token}\\b`, 'i').test(text)
}

function matchesSearch(
  outfit: OutfitWithItems,
  query: string,
  colour: ColourFamily | null,
  itemTypes: string[] | null,
  brand: string,
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

  // Free text: each token must match a whole word in at least one field
  if (query.trim()) {
    const tokens = query.toLowerCase().trim().split(/\s+/)
    for (const token of tokens) {
      const hit = items.some(it => {
        if (wordMatch(it.product_name, token)) return true
        if (wordMatch((it as any).brand?.name, token)) return true
        if (wordMatch(it.material_primary, token)) return true
        if (wordMatch(String(it.item_type).replace(/_/g, ' '), token)) return true
        // colour_family: exact match only
        if (it.colour_family === token) return true
        return false
      }) ||
        wordMatch(outfit.aesthetic_label, token) ||
        (outfit.occasion_tags ?? []).some(t => wordMatch(t, token))
      if (!hit) return false
    }
  }

  return true
}

// ── Component ────────────────────────────────────────────────
export default function FeedClient({
  showAllOption = false,
  injectedOutfits,
  detailHrefBase = '/outfit',
  canSave = false,
  savedOutfitIds = [],
  recommendedOutfits = [],
}: {
  showAllOption?: boolean
  injectedOutfits?: OutfitWithItems[]
  detailHrefBase?: string
  // Save (heart) + recommendations — only passed for signed-in early-access users.
  canSave?: boolean
  savedOutfitIds?: string[]
  recommendedOutfits?: OutfitWithItems[]
}) {
  const savedSet = new Set(savedOutfitIds)
  // Occasion mode
  const [occasion, setOccasion]           = useState<string | null>(null)
  const [outfits, setOutfits]             = useState<OutfitWithItems[]>([])
  const [loading, setLoading]             = useState(false)
  const [loadingMore, setLoadingMore]     = useState(false)
  const [offset, setOffset]               = useState(0)
  const [hasMore, setHasMore]             = useState(true)
  const loadMoreRef                        = useRef<HTMLDivElement>(null)

  // Search / filter mode
  const [searchQuery, setSearchQuery]     = useState('')
  const [filterColour, setFilterColour]   = useState<ColourFamily | null>(null)
  const [filterItemGroup, setFilterItemGroup] = useState<string | null>(null)
  const [filterBrand, setFilterBrand]     = useState('')
  const [filterPanel, setFilterPanel]     = useState<'colour' | 'item' | 'brand' | null>(null)
  const [searchMode, setSearchMode]       = useState(false)
  const [searchResults, setSearchResults] = useState<OutfitWithItems[]>([])
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

  // ── Occasion fetch ─────────────────────────────────────────
  const fetchOutfits = useCallback(async (tag: string, currentOffset: number, append: boolean) => {
    if (injectedOutfits) {
      const filtered = tag && tag !== 'all'
        ? injectedOutfits.filter((o) => (o.occasion_tags ?? []).includes(tag))
        : injectedOutfits
      // One outfit per anchor item — variants stay in Similar/Explore.
      const ordered = antiRepeatOrder(dedupeByAnchor(filtered))
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
      query = query.contains('occasion_tags', [tag])
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

    const results = allOutfits.filter(o =>
      matchesSearch(o, searchQuery, filterColour, itemTypes, filterBrand)
    )
    setSearchResults(antiRepeatOrder(results))
    setSearchLoading(false)
  }, [hasActiveSearch, injectedOutfits, searchQuery, filterColour, filterItemGroup, filterBrand])

  function clearSearch() {
    setSearchMode(false)
    setSearchResults([])
    setSearchQuery('')
    setFilterColour(null)
    setFilterItemGroup(null)
    setFilterBrand('')
    setFilterPanel(null)
  }

  // ── Handlers ───────────────────────────────────────────────
  const handleStyleItem    = (itemId: string, itemType: ItemType, outfit: OutfitWithItems) =>
    router.push(`${detailHrefBase}/${outfit.outfit_id}?styleItem=${itemId}&itemType=${itemType}`)
  const handleSimilarLooks = (outfit: OutfitWithItems) =>
    router.push(`${detailHrefBase}/${outfit.outfit_id}?mode=similar`)
  const handleExploreStyles = (outfit: OutfitWithItems) =>
    router.push(`${detailHrefBase}/${outfit.outfit_id}?mode=explore`)

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
  if (!occasion && !searchMode) {
    return (
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-16 flex flex-col">
        <div className="order-1 text-center mb-10">
          <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-4">YOUR OCCASION</p>
          <h1 className="text-[clamp(28px,3vw,40px)] tracking-[0.045em] text-[#4A4E57] leading-tight">
            WHAT ARE YOU DRESSING FOR?
          </h1>
        </div>

        {/* Recommended for you — personalised from saves + brand worlds */}
        {recommendedOutfits.length > 0 && (
          <div className="order-4 max-w-[1100px] mx-auto mb-12">
            <div className="flex items-baseline justify-between mb-4">
              <p className="text-[11px] tracking-[0.099em] text-[#4A4E57]">RECOMMENDED FOR YOU</p>
              <p className="text-[9px] tracking-[0.072em] text-[#A8A8A4]">BASED ON WHAT YOU LIKE</p>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
              {recommendedOutfits.map((o) => (
                <button
                  key={o.outfit_id}
                  onClick={() => router.push(`${detailHrefBase}/${o.outfit_id}`)}
                  className="group relative shrink-0 w-[150px] sm:w-[170px]"
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[12px] bg-[#EDEDED]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={o.image_url || '/placeholder-outfit.jpg'}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                    {canSave && (
                      <SaveHeartButton outfitId={o.outfit_id} initialSaved={savedSet.has(o.outfit_id)} />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {showAllOption && (
          <div className="order-5 max-w-[900px] mx-auto mb-6">
            <button
              onClick={() => setOccasion('all')}
              className="glass-dark w-full text-[#4A4E57] px-4 py-4 text-[11px] tracking-[0.09em] rounded-full"
            >
              ↓ VIEW EVERYTHING LIVE
            </button>
          </div>
        )}

        {/* Occasion grid */}
        <div className="order-6 grid grid-cols-2 md:grid-cols-3 gap-3 max-w-[900px] mx-auto mb-10">
          {PRESET_OCCASIONS.map((occ) => (
            <button
              key={occ.tag}
              onClick={() => setOccasion(occ.tag)}
              className="glass-light px-4 py-6 text-[11px] tracking-[0.09em] text-[#4A4E57] text-center rounded-[16px] active:scale-[0.99]"
            >
              {occ.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="order-2 flex items-center gap-6 max-w-[900px] mx-auto mb-8">
          <div className="flex-1 border-t border-[#E2E0DB]" />
          <span className="text-[10px] tracking-[0.113em] text-[#A8A8A4]">OR SEARCH</span>
          <div className="flex-1 border-t border-[#E2E0DB]" />
        </div>

        {/* Search + filter area */}
        <div className="order-3 max-w-[700px] mx-auto mb-10">

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

          {/* Search input */}
          <form
            onSubmit={(e) => { e.preventDefault(); executeSearch() }}
            className="flex gap-3 mb-4"
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={typedHint ? `${typedHint}▌` : 'SEARCH BY STYLE, COLOUR, BRAND, MATERIAL…'}
              className="glass-input flex-1 px-5 py-3.5 rounded-full text-[11px] tracking-[0.054em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!hasActiveSearch}
              className="glass-dark text-[#4A4E57] px-7 py-3.5 rounded-full text-[11px] tracking-[0.09em] flex-shrink-0 disabled:opacity-30"
            >
              FIND
            </button>
          </form>

          {/* Filter pills */}
          <div className="flex gap-2 mb-4">
            {(['colour', 'item', 'brand'] as const).map((type) => {
              const isActive = filterPanel === type
              const hasValue = type === 'colour' ? !!filterColour : type === 'item' ? !!filterItemGroup : !!filterBrand.trim()
              return (
                <button
                  key={type}
                  onClick={() => setFilterPanel(isActive ? null : type)}
                  className={`px-4 py-2 text-[9px] tracking-[0.081em] rounded-[12px] border transition-colors duration-200 ${
                    hasValue
                      ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                      : isActive
                        ? 'bg-[#FAFAF8] text-[#4A4E57] border-[#0A0A0A]'
                        : 'bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A] hover:text-[#4A4E57]'
                  }`}
                >
                  {type === 'colour' ? 'COLOUR' : type === 'item' ? 'ITEM TYPE' : 'BRAND'} {isActive ? '▲' : '▾'}
                </button>
              )
            })}
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

  // ── SEARCH RESULTS VIEW ───────────────────────────────────
  if (searchMode) {
    return (
      <div className="max-w-[1440px] mx-auto px-6 sm:px-10 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-1">SEARCH</p>
            <h2 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">{activeFilterLabel()}</h2>
          </div>
          <button
            onClick={clearSearch}
            className="text-[11px] tracking-[0.09em] text-[#6B6B6B] border border-[#E2E0DB] px-5 py-2.5 rounded-[12px] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-all duration-300"
          >
            CLEAR
          </button>
        </div>

        {searchLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

        {!searchLoading && searchResults.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {searchResults.map((outfit) => (
              <OutfitCard
                key={outfit.outfit_id}
                outfit={outfit}
                detailHref={`${detailHrefBase}/${outfit.outfit_id}`}
                onSimilarLooks={handleSimilarLooks}
                onExploreStyles={handleExploreStyles}
                onStyleItem={handleStyleItem}
                canSave={canSave}
                initialSaved={savedSet.has(outfit.outfit_id)}
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
          <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-1">YOUR OCCASION</p>
          <h2 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">
            {occasion === 'all' ? 'EVERYTHING LIVE' : occasion!.toUpperCase()}
          </h2>
        </div>
        <button
          onClick={() => setOccasion(null)}
          className="text-[11px] tracking-[0.09em] text-[#6B6B6B] border border-[#E2E0DB] px-5 py-2.5 rounded-[12px] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-all duration-300"
        >
          CHANGE
        </button>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {outfits.map((outfit) => (
              <OutfitCard
                key={outfit.outfit_id}
                outfit={outfit}
                detailHref={`${detailHrefBase}/${outfit.outfit_id}`}
                onSimilarLooks={handleSimilarLooks}
                onExploreStyles={handleExploreStyles}
                onStyleItem={handleStyleItem}
                canSave={canSave}
                initialSaved={savedSet.has(outfit.outfit_id)}
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

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { useRouter } from 'next/navigation'
import Hotspot from '@/components/hotspot/Hotspot'
import ShopTheLookOverlay from '@/components/source-panel/ShopTheLookOverlay'
import OutfitCard from '@/components/outfit-card/OutfitCard'
import SaveHeartButton from '@/components/outfit-card/SaveHeartButton'
import CoachTip from '@/components/CoachTip'
import { createClient } from '@/lib/supabase'
import { getRelatedOutfits, getStyleItemOutfits } from './related-actions'
import { trackEngagement } from '@/lib/track'
import { toggleSaveItem } from '@/app/edit/save-actions'
import ShopLink from '@/components/ShopLink'
import { formatGbp } from '@/lib/currency'
import type { OutfitWithItems, Item, Brand, ItemType } from '@/types/database'

// Feature flag — hide the SIMILAR LOOKS / EXPLORE STYLES buttons on the
// outfit detail page until THE EDIT / OCCASIONS sections are launched.
// Flip to `true` to re-expose both buttons (all handlers + result grids
// stay in place, so nothing else needs to change).
const SHOW_BROWSE_BUTTONS = true

// White overlaid action text (matches the editorial feed cards).
const ACTION_CLS = 'pointer-events-auto text-white text-[12px] sm:text-[13px] tracking-[0.12em] uppercase font-light hover:opacity-70 transition-opacity'

type SourceItemData = Item & { brand: Brand }

interface OutfitDetailClientProps {
  outfitId: string
  styleItemId?: string
  itemType?: string
  mode?: 'similar' | 'explore'
  // Admin preview overrides — public route passes none, behaviour unchanged:
  initialOutfit?: OutfitWithItems   // server-fetched (admin client) so items show despite RLS
  showBrowseButtons?: boolean       // force-enable SIMILAR / EXPLORE
  linkBase?: string                 // base path for related/result links (default public detail)
  canSave?: boolean                 // show the SAVE toggle (signed-in users)
  initialSaved?: boolean
  savedItemIds?: string[]           // item ids already in the user's wardrobe
}

export default function OutfitDetailClient({
  outfitId,
  styleItemId,
  itemType,
  mode,
  initialOutfit,
  showBrowseButtons,
  linkBase = '/outfit',
  canSave = false,
  initialSaved = false,
  savedItemIds = [],
}: OutfitDetailClientProps) {
  const router = useRouter()
  const showBrowse = showBrowseButtons ?? SHOW_BROWSE_BUTTONS
  const [outfit, setOutfit] = useState<OutfitWithItems | null>(initialOutfit ?? null)
  const [styleItemOutfits, setStyleItemOutfits] = useState<OutfitWithItems[]>([])
  const [relatedOutfits, setRelatedOutfits] = useState<OutfitWithItems[]>([])
  // Which related view is showing — drives the results heading (the URL `mode`
  // is only the initial value; clicking the buttons updates this).
  const [activeMode, setActiveMode] = useState<'similar' | 'explore' | null>(mode ?? null)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)
  // The Source Items panel overlays the hero image; keep a ref so opening it
  // always scrolls the hero into view (it can be off-screen after scrolling
  // down to the styled results).
  const heroRef = useRef<HTMLDivElement>(null)
  const openSourcePanel = () => {
    const next = !sourcePanelOpen
    setSourcePanelOpen(next)
    if (next) {
      if (outfit) trackEngagement('source_items', outfit.outfit_id)
      requestAnimationFrame(() => heroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    }
  }

  // Saved items live here (lifted) so the Shop-the-look hearts and the image
  // hover heart stay in sync. Optimistic; reverts on error.
  const [savedItemSet, setSavedItemSet] = useState<Set<string>>(() => new Set(savedItemIds))
  function toggleItem(itemId: string) {
    const willSave = !savedItemSet.has(itemId)
    setSavedItemSet((prev) => {
      const next = new Set(prev)
      if (willSave) next.add(itemId)
      else next.delete(itemId)
      return next
    })
    toggleSaveItem(itemId, outfitId).then((res) => {
      if (res?.error) {
        setSavedItemSet((prev) => {
          const next = new Set(prev)
          if (willSave) next.delete(itemId)
          else next.add(itemId)
          return next
        })
      }
    })
  }
  const [activeStyleItemId, setActiveStyleItemId] = useState<string | null>(styleItemId ?? null)
  const [activeItemType, setActiveItemType] = useState<ItemType | null>(itemType as ItemType ?? null)
  const [loading, setLoading] = useState(!initialOutfit)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  // Onboarding coach-tips shown ONE AT A TIME (0=tap-to-style, 1=source,
  // 2=similar, 3=explore) so they never stack on top of each other.
  const [coachStep, setCoachStep] = useState(0)
  const advanceCoach = (n: number) => setCoachStep((s) => Math.max(s, n + 1))

  // Ordered list of sibling outfits so the user can swipe/arrow between looks.
  const [siblings, setSiblings] = useState<{ id: string; image: string }[]>([])
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  // ── Fetch main outfit ─────────────────────────────────────
  useEffect(() => {
    // Admin preview supplies the outfit (with items) directly — skip the browser
    // fetch, which can't read items hidden by row-level security.
    if (initialOutfit) return
    async function load() {
      setLoading(true)
      const supabase = createClient()

      const { data, error } = await supabase
        .from('outfit')
        .select(`
          *,
          outfit_item (
            *,
            item (
              *,
              brand (*)
            )
          )
        `)
        .eq('outfit_id', outfitId)
        .single()

      if (!error && data) {
        setOutfit(data as OutfitWithItems)
      }
      setLoading(false)
    }

    load()
  }, [outfitId, initialOutfit])

  // ── Load sibling outfits (for swiping between looks) ──────
  useEffect(() => {
    async function loadSiblings() {
      const supabase = createClient()
      const { data } = await supabase
        .from('outfit')
        .select('outfit_id, image_url, outfit_item(item_id, slot)')
        .eq('status', 'live')
        .order('published_at', { ascending: false })
      if (!data) return

      // Hero garment of an outfit (dress → top → bottom → outerwear → first).
      const anchorOf = (oi: { item_id: string; slot: string }[]): string | null => {
        const bySlot = (s: string) => oi.find((x) => x.slot === s)?.item_id
        return bySlot('dress') || bySlot('top') || bySlot('bottom') || bySlot('outerwear') || oi[0]?.item_id || null
      }

      // One look per anchor garment so adjacent looks aren't the same piece
      // styled twice. Keep the FIRST per anchor, but make sure THIS outfit is
      // the one kept for its own anchor (so nav/peek stays anchored on it).
      const seen = new Map<string, number>()
      const out: { id: string; image: string }[] = []
      for (const o of data as { outfit_id: string; image_url: string; outfit_item: { item_id: string; slot: string }[] }[]) {
        const anchor = anchorOf(o.outfit_item ?? [])
        if (anchor && seen.has(anchor)) {
          if (o.outfit_id === outfitId) out[seen.get(anchor)!] = { id: o.outfit_id, image: o.image_url }
          continue
        }
        if (anchor) seen.set(anchor, out.length)
        out.push({ id: o.outfit_id, image: o.image_url })
      }
      setSiblings(out)
    }
    loadSiblings()
  }, [outfitId])

  // Navigate to a specific look (by absolute index) or by direction.
  const goToIndex = useCallback((target: number) => {
    if (target < 0 || target >= siblings.length) return
    router.push(`${linkBase}/${siblings[target].id}`)
  }, [siblings, router, linkBase])

  const goToSibling = useCallback((dir: -1 | 1) => {
    const idx = siblings.findIndex((s) => s.id === outfitId)
    if (idx === -1) return
    goToIndex(idx + dir)
  }, [siblings, outfitId, goToIndex])

  // Arrow keys move between looks (desktop).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goToSibling(-1)
      else if (e.key === 'ArrowRight') goToSibling(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goToSibling])

  // ── Fetch style item outfits ──────────────────────────────
  // Server action (admin client) so each result card carries its full items —
  // the anon client drops them under RLS, which broke the cards' SOURCE ITEMS.
  const fetchStyleItemOutfits = useCallback(async (itemId: string) => {
    const res = await getStyleItemOutfits(outfitId, itemId)
    setStyleItemOutfits(res.outfits ?? [])
  }, [outfitId])

  // ── Fetch similar / explore outfits ───────────────────────
  // Server action: SIMILAR = same silhouette as this outfit (long dress → long
  // dresses); EXPLORE = same occasion but a different silhouette. The two sets
  // are disjoint, so the buttons never return overlapping outfits.
  const fetchRelatedOutfits = useCallback(async (
    currentOutfit: OutfitWithItems,
    fetchMode: 'similar' | 'explore'
  ) => {
    setActiveMode(fetchMode)
    const res = await getRelatedOutfits(currentOutfit.outfit_id, fetchMode)
    setRelatedOutfits(res.outfits ?? [])
  }, [])

  // ── Effects ───────────────────────────────────────────────
  useEffect(() => {
    if (activeStyleItemId) {
      fetchStyleItemOutfits(activeStyleItemId)
    }
  }, [activeStyleItemId, fetchStyleItemOutfits])

  useEffect(() => {
    if (outfit && mode) {
      fetchRelatedOutfits(outfit, mode)
    }
  }, [outfit, mode, fetchRelatedOutfits])

  // ── Handlers ──────────────────────────────────────────────
  const handleStyleItem = (itemId: string, iType: ItemType) => {
    trackEngagement('style_item', itemId)
    setActiveStyleItemId(itemId)
    setActiveItemType(iType)
    setStyleItemOutfits([])
    fetchStyleItemOutfits(itemId)
  }

  const handleSimilarLooks = () => {
    if (!outfit) return
    trackEngagement('similar_looks', outfit.outfit_id)
    // Clear any active style-item view so the Similar results aren't suppressed
    // (the results section only renders when no style-item is active).
    setActiveStyleItemId(null)
    setActiveItemType(null)
    setStyleItemOutfits([])
    fetchRelatedOutfits(outfit, 'similar')
  }

  const handleExploreStyles = () => {
    if (!outfit) return
    trackEngagement('explore_styles', outfit.outfit_id)
    setActiveStyleItemId(null)
    setActiveItemType(null)
    setStyleItemOutfits([])
    fetchRelatedOutfits(outfit, 'explore')
  }

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto px-10 py-12">
        <div className="aspect-[3/4] bg-[#F2F2F2] animate-pulse" />
      </div>
    )
  }

  if (!outfit) {
    return (
      <div className="text-center py-24 px-10">
        <p className="text-[11px] tracking-[0.113em] text-[#A8A8A4]">OUTFIT NOT FOUND</p>
        <button
          onClick={() => router.back()}
          className="mt-6 text-[11px] tracking-[0.09em] underline text-[#6B6B6B]"
        >
          GO BACK
        </button>
      </div>
    )
  }

  const items: SourceItemData[] = (outfit.outfit_item ?? [])
    .filter((oi) => oi.item != null)
    .map((oi) => ({
      ...oi.item,
      brand: oi.item?.brand ?? null,
    }))

  const activeItemLabel = activeItemType
    ? activeItemType.toUpperCase().replace('_', ' ')
    : null

  // Build the full image list so the user can scroll through every piece:
  // the outfit shot, any additional shots, then each item's product photo.
  const allImages: string[] = Array.from(
    new Set(
      [
        outfit.image_url,
        ...(((outfit as unknown as { additional_images?: string[] }).additional_images) ?? []),
        ...items.map((it) => it.image_url),
      ].filter(Boolean) as string[],
    ),
  )
  const safeIndex = Math.min(currentImageIndex, allImages.length - 1)
  const currentImageUrl = allImages[safeIndex] ?? outfit.image_url

  // Which item (if any) the currently-shown photo belongs to — so we can offer
  // to save that specific piece when the user hovers its image.
  const imageItemMap = new Map(items.filter((it) => it.image_url).map((it) => [it.image_url as string, it]))
  const currentItem = imageItemMap.get(currentImageUrl)

  // Position of this look in the list, for prev/next between outfits.
  const siblingIdx = siblings.findIndex((s) => s.id === outfitId)
  const hasPrevLook = siblingIdx > 0
  const hasNextLook = siblingIdx >= 0 && siblingIdx < siblings.length - 1
  const prevImage = hasPrevLook ? siblings[siblingIdx - 1].image : null
  const nextImage = hasNextLook ? siblings[siblingIdx + 1].image : null

  // Windowed dots (the list can be long — show up to 7 around the current look).
  const DOTS = 7
  const dotStart = siblings.length <= DOTS
    ? 0
    : Math.max(0, Math.min(siblingIdx - Math.floor(DOTS / 2), siblings.length - DOTS))
  const dotIndices = Array.from(
    { length: Math.min(DOTS, siblings.length) },
    (_, k) => dotStart + k,
  )

  // Swipe between looks (horizontal swipe wins over vertical scroll).
  function onLookTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  function onLookTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      goToSibling(dx < 0 ? 1 : -1) // swipe left → next, swipe right → prev
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-10 py-4 sm:py-8">

      {/* ── Back + Nav (desktop; on mobile these overlay the image) ─────── */}
      <div className="hidden sm:flex items-center justify-between mb-8">
        <button
          onClick={() => router.back()}
          className="text-[11px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 flex items-center gap-2"
        >
          ← BACK
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => goToSibling(-1)}
            disabled={!hasPrevLook}
            aria-label="Previous look"
            className="text-[20px] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 leading-none disabled:opacity-25 disabled:cursor-default"
          >
            ‹
          </button>
          <button
            onClick={() => goToSibling(1)}
            disabled={!hasNextLook}
            aria-label="Next look"
            className="text-[20px] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 leading-none disabled:opacity-25 disabled:cursor-default"
          >
            ›
          </button>
        </div>
      </div>

      {/* ── Main outfit detail ────────────────────────────── */}
      <div className="mb-12">
        {/* When the shown photo is a product ITEM, present it Cult-Gaia style:
            detail on the left, image on the right (desktop) — detail under the
            image (mobile). The outfit carousel shows only for the look itself. */}
        {currentItem ? (
          <ItemDetailView
            item={currentItem}
            total={allImages.length}
            onPrev={() => setCurrentImageIndex((i) => (i - 1 + allImages.length) % allImages.length)}
            onNext={() => setCurrentImageIndex((i) => (i + 1) % allImages.length)}
            onBackToOutfit={() => setCurrentImageIndex(0)}
            outfitId={outfitId}
            outfitImage={outfit.image_url}
            linkBase={linkBase}
          />
        ) : (
        // Single look — full-bleed on mobile, large & centred on desktop. Looks
        // are flash-cards: swipe or use the top arrows to move between them.
        <div className="relative">
            <div
              ref={heroRef}
              className="relative z-10 bg-white overflow-hidden group scroll-mt-20 aspect-[3/4] -mx-4 sm:mx-auto sm:w-full sm:max-w-[820px]"
              onTouchStart={onLookTouchStart}
              onTouchEnd={onLookTouchEnd}
            >
              <ImageWithHotspots
                key={currentImageUrl}
                outfit={outfit}
                imageUrl={currentImageUrl}
                activeItemLabel={safeIndex === 0 ? activeItemLabel : null}
                onStyleItem={handleStyleItem}
                showHotspots={safeIndex === 0}
              />

              {/* Mobile-only overlay header: BACK + look arrows in white, on the
                  image, so the photo can run full width edge-to-edge. */}
              <div className="sm:hidden absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 pt-3 pointer-events-none">
                <button
                  onClick={() => router.back()}
                  className="pointer-events-auto text-white text-[11px] tracking-[0.09em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
                >
                  ← BACK
                </button>
                <div className="flex items-center gap-5 pointer-events-auto">
                  <button
                    onClick={() => goToSibling(-1)}
                    disabled={!hasPrevLook}
                    aria-label="Previous look"
                    className="text-white text-[24px] leading-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] disabled:opacity-30"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => goToSibling(1)}
                    disabled={!hasNextLook}
                    aria-label="Next look"
                    className="text-white text-[24px] leading-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] disabled:opacity-30"
                  >
                    ›
                  </button>
                </div>
              </div>

              {/* Coach-mark high on the image so it doesn't collide with the
                  action-button tips along the bottom. */}
              {!sourcePanelOpen && !activeStyleItemId && (
                <CoachTip
                  id="outfit-tap-to-style"
                  text="Tap any piece to restyle it."
                  arrow="up"
                  widthClass="w-[168px]"
                  className="left-1/2 -translate-x-1/2 top-[22%]"
                  delayMs={1000}
                  active={coachStep === 0}
                  onResolved={() => advanceCoach(0)}
                />
              )}

              {/* Save heart on an ITEM photo — appears on hover, top-right */}
              {canSave && currentItem && !sourcePanelOpen && (
                <button
                  onClick={() => toggleItem(currentItem.item_id)}
                  aria-label={savedItemSet.has(currentItem.item_id) ? 'Remove item from wardrobe' : 'Save item to wardrobe'}
                  className="absolute top-3 right-3 z-30 w-9 h-9 rounded-full bg-white/90 hover:bg-white shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <span className={`text-[16px] leading-none ${savedItemSet.has(currentItem.item_id) ? 'text-[#C8302A]' : 'text-[#6B6B6B]'}`}>
                    {savedItemSet.has(currentItem.item_id) ? '♥' : '♡'}
                  </span>
                </button>
              )}

              {/* Shop-the-look cards overlaid on the image (toggled by SOURCE ITEMS) */}
              {sourcePanelOpen && items.length > 0 && (
                <ShopTheLookOverlay
                  items={items}
                  outfitId={outfitId}
                  onClose={() => setSourcePanelOpen(false)}
                  canSave={canSave}
                  savedItemIds={[...savedItemSet]}
                  onToggleItem={toggleItem}
                  offsetTop
                />
              )}

              {allImages.length > 1 && (
                <>
                  {/* Prev photo — bare arrow, no circle */}
                  <button
                    type="button"
                    onClick={() => setCurrentImageIndex((i) => (i - 1 + allImages.length) % allImages.length)}
                    className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-9 flex items-center justify-center text-white text-[34px] leading-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] hover:opacity-70 transition-opacity duration-200 z-20"
                    aria-label="Previous photo"
                  >
                    ‹
                  </button>
                  {/* Next photo — bare arrow, no circle */}
                  <button
                    type="button"
                    onClick={() => setCurrentImageIndex((i) => (i + 1) % allImages.length)}
                    className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 w-9 flex items-center justify-center text-white text-[34px] leading-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] hover:opacity-70 transition-opacity duration-200 z-20"
                    aria-label="Next photo"
                  >
                    ›
                  </button>

                  {/* Counter — mobile: plain white text at the very top (no pill),
                      flanked by BACK/arrows. Desktop: subtle pill, top-right. */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 sm:top-3 sm:left-auto sm:translate-x-0 sm:right-3 z-30 text-white text-[11px] sm:text-[10px] tracking-[0.1em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)] sm:drop-shadow-none sm:bg-black/60 sm:px-2.5 sm:py-1 sm:rounded-full">
                    {safeIndex + 1} / {allImages.length}
                  </div>
                </>
              )}

              {/* Browse actions overlaid on the image (editorial, matches the feed).
                  Kept visible even when the Source panel is open, so the user can
                  still reach Similar Looks / Explore Styles or toggle Source off.
                  z-40 sits above the Source overlay so the buttons stay clickable. */}
                <div className="absolute inset-x-0 bottom-0 z-40 pt-12 pb-5 px-4 bg-gradient-to-t from-black/55 via-black/20 to-transparent pointer-events-none">
                  {/* All three on one row (the hero is wide enough on both).
                      Coach-tips are slim and staggered — Similar sits higher, the
                      outer two anchor to their edges — so they don't overlap. */}
                  <div className="flex flex-wrap items-center justify-center gap-x-5 sm:gap-x-8 gap-y-1.5">
                    <span className="relative">
                      <button onClick={openSourcePanel} className={ACTION_CLS}>Source Items</button>
                      <CoachTip id="outfit-source-items" text="Shop direct from the retailer." arrow="down" widthClass="w-[164px]" className="bottom-full mb-2.5 left-0" delayMs={300} active={coachStep === 1} onResolved={() => advanceCoach(1)} />
                    </span>
                    {showBrowse && (
                      <span className="relative">
                        <button onClick={handleSimilarLooks} className={ACTION_CLS}>Similar Looks</button>
                        <CoachTip id="outfit-similar-looks" text="More outfits with the same shape." arrow="down" widthClass="w-[164px]" className="bottom-full mb-2.5 left-1/2 -translate-x-1/2" delayMs={300} active={coachStep === 2} onResolved={() => advanceCoach(2)} />
                      </span>
                    )}
                    {showBrowse && (
                      <span className="relative">
                        <button onClick={handleExploreStyles} className={ACTION_CLS}>Explore Styles</button>
                        <CoachTip id="outfit-explore-styles" text="Other looks for this occasion." arrow="down" widthClass="w-[164px]" className="bottom-full mb-2.5 right-0" delayMs={300} active={coachStep === 3} onResolved={() => advanceCoach(3)} />
                      </span>
                    )}
                  </div>
                </div>
            </div>
        </div>
        )}

        {/* Look position dots — only while browsing looks, not an item photo */}
        {siblings.length > 1 && !currentItem && (
          <div className="flex items-center justify-center gap-1.5 mt-5 mb-1">
            {dotIndices.map((di) => (
              <button
                key={di}
                type="button"
                onClick={() => goToIndex(di)}
                aria-label={`Go to look ${di + 1}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  di === siblingIdx ? 'w-5 bg-[#0A0A0A]' : 'w-1.5 bg-[#D8D6D1] hover:bg-[#A8A8A4]'
                }`}
              />
            ))}
          </div>
        )}

        <div className="max-w-[560px] mx-auto mt-6">
        {/* Thumbnail strip */}
        {allImages.length > 1 && (
          <div className="flex gap-2 justify-center mb-4 mt-3">
            {allImages.map((url, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentImageIndex(idx)}
                className={`relative w-14 h-16 border overflow-hidden transition-all duration-200 ${
                  idx === safeIndex
                    ? 'border-[#0A0A0A] opacity-100'
                    : 'border-[#E2E0DB] opacity-60 hover:opacity-100'
                }`}
                aria-label={`View photo ${idx + 1}`}
              >
                <FallbackImage src={url} thumbWidth={160} alt={`Photo ${idx + 1}`} loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}


        {/* Occasion tags are internal (search/curation) — not shown to visitors. */}

        {/* Source Items / Similar Looks / Explore Styles are now overlaid on the
            image above (editorial). Only SAVE remains here for signed-in users. */}
        {canSave && (
          <div className="flex items-center justify-center">
            <SaveHeartButton outfitId={outfitId} initialSaved={initialSaved} variant="detail" />
          </div>
        )}
        </div>
      </div>

      {/* ── Style Item results ─────────────────────────────── */}
      {activeStyleItemId && styleItemOutfits.length > 0 && (
        <div className="mt-8">
          {/* Spacer between original and results */}
          <div className="border-t border-[#E2E0DB] mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {styleItemOutfits.map((o) => (
              <OutfitCard
                key={o.outfit_id}
                outfit={o}
                detailHref={`${linkBase}/${o.outfit_id}`}
                onSimilarLooks={() => router.push(`${linkBase}/${o.outfit_id}?mode=similar`)}
                onExploreStyles={() => router.push(`${linkBase}/${o.outfit_id}?mode=explore`)}
                onStyleItem={(itemId, iType) => handleStyleItem(itemId, iType)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Similar / Explore results ──────────────────────── */}
      {relatedOutfits.length > 0 && !activeStyleItemId && (
        <div className="mt-8">
          <div className="border-t border-[#E2E0DB] mb-6" />
          <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-8 text-center">
            {activeMode === 'explore' ? 'EXPLORE STYLES' : 'SIMILAR LOOKS'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {relatedOutfits.map((o) => (
              <OutfitCard
                key={o.outfit_id}
                outfit={o}
                detailHref={`${linkBase}/${o.outfit_id}`}
                onSimilarLooks={() => router.push(`${linkBase}/${o.outfit_id}?mode=similar`)}
                onExploreStyles={() => router.push(`${linkBase}/${o.outfit_id}?mode=explore`)}
                onStyleItem={(itemId, iType) => handleStyleItem(itemId, iType)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Image with hover-reveal hotspots ─────────────────────────
function ImageWithHotspots({
  outfit,
  imageUrl,
  activeItemLabel,
  onStyleItem,
  showHotspots = true,
}: {
  outfit: OutfitWithItems
  imageUrl?: string
  activeItemLabel: string | null
  onStyleItem: (itemId: string, itemType: ItemType) => void
  showHotspots?: boolean
}) {
  const [imageHovered, setImageHovered] = useState(false)
  const src = imageUrl || outfit.image_url || '/placeholder-outfit.jpg'

  return (
    <div
      className="relative aspect-[3/4] w-full overflow-hidden bg-white"
      onMouseEnter={() => setImageHovered(true)}
      onMouseLeave={() => setImageHovered(false)}
    >
      <FallbackImage
        src={src}
        thumbWidth={1100}
        alt={outfit.aesthetic_label}
        className="absolute inset-0 w-full h-full object-contain"
      />

      {showHotspots && (outfit.outfit_item ?? []).filter((oi) => oi.item != null).map((oi) => {
        const pos = getDetailHotspotPosition(oi.slot)
        return (
          <Hotspot
            key={oi.outfit_item_id}
            itemId={oi.item_id}
            itemType={oi.item?.item_type ?? 'coat'}
            x={pos.x}
            y={pos.y}
            variant="detail"
            imageHovered={imageHovered}
            onStyleItem={onStyleItem}
          />
        )
      })}
    </div>
  )
}

// ── Product item view (Cult-Gaia style) ─────────────────────
// Shown when the current photo belongs to a specific item. Desktop: detail on
// the left, the image glides in to the right. Mobile: image on top, then name /
// price / retailer button underneath.

function ItemDetailView({
  item,
  total,
  onPrev,
  onNext,
  onBackToOutfit,
  outfitId,
  outfitImage,
  linkBase,
}: {
  item: SourceItemData
  total: number
  onPrev: () => void
  onNext: () => void
  onBackToOutfit: () => void
  outfitId: string
  outfitImage: string | null
  linkBase: string
}) {
  const router = useRouter()
  const nextImg = item.image_url ?? ''
  // Re-trigger the soft cross-fade each time the shown item changes.
  const [entered, setEntered] = useState(false)
  // Two stacked layers so the previous product stays visible underneath while
  // the new one fades in over it — a cross-dissolve, not a hard swap.
  const [front, setFront] = useState(nextImg)
  const [back, setBack] = useState<string | null>(null)
  const prevImg = useRef(nextImg)
  // Other live looks that feature this exact piece ("styled with this piece").
  const [tagged, setTagged] = useState<OutfitWithItems[]>([])
  const touchX = useRef<number | null>(null)
  useEffect(() => {
    if (prevImg.current && prevImg.current !== nextImg) setBack(prevImg.current)
    setFront(nextImg)
    prevImg.current = nextImg
    setEntered(false)
    const r = requestAnimationFrame(() => setEntered(true))
    // Drop the old layer once the fade has completed.
    const t = setTimeout(() => setBack(null), 780)
    return () => { cancelAnimationFrame(r); clearTimeout(t) }
  }, [item.item_id, nextImg])
  useEffect(() => {
    let live = true
    setTagged([])
    getStyleItemOutfits(outfitId, item.item_id).then((res) => {
      if (live) setTagged(res.outfits ?? [])
    })
    return () => { live = false }
  }, [item.item_id, outfitId])

  // Big item view: GBP with the original currency in brackets, e.g. "£335 (€390)".
  const price = formatGbp(item.price ?? null, item.currency ?? null, { showOriginal: true })
  const descriptors = [
    item.item_type ? String(item.item_type).replace(/_/g, ' ') : null,
    item.material_primary,
    item.colour_family,
  ].filter(Boolean) as string[]

  function onTouchStart(e: React.TouchEvent) { touchX.current = e.touches[0].clientX }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current === null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (Math.abs(dx) > 40) (dx < 0 ? onNext() : onPrev())
  }

  // The image cross-dissolves between products (two stacked layers) and the
  // detail column softly fades in alongside it — no slide, matching the ref.
  return (
    <div className="overflow-x-hidden">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-12 items-center sm:min-h-[68vh]">
      {/* Detail — left on desktop, under the image on mobile */}
      <div
        className="order-2 sm:order-1 sm:pr-8 will-change-transform"
        style={{
          transition: entered ? 'opacity 640ms ease-out, transform 900ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          transform: entered ? 'translateY(0)' : 'translateY(8px)',
          opacity: entered ? 1 : 0,
        }}
      >
        <button
          onClick={onBackToOutfit}
          className="text-[10px] tracking-[0.12em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors duration-300"
        >
          ← BACK TO LOOK
        </button>
        <p className="mt-6 text-[10px] tracking-[0.16em] uppercase text-[#A8A8A4]">{item.brand?.name ?? 'MYRA'}</p>
        <h2 className="mt-3 text-[22px] sm:text-[32px] leading-[1.08] tracking-[0.01em] text-[#0A0A0A] font-light uppercase">
          {item.product_name}
        </h2>
        {price && <p className="mt-4 text-[15px] sm:text-[16px] tracking-[0.04em] text-[#0A0A0A]">{price}</p>}

        {descriptors.length > 0 && (
          <div className="mt-6 space-y-1.5 hidden sm:block">
            {descriptors.map((d, i) => (
              <p key={i} className="text-[12px] tracking-[0.02em] text-[#4A4E57]">
                — {d.charAt(0).toUpperCase() + d.slice(1)}
              </p>
            ))}
          </div>
        )}

        {item.retailer_url && (
          <ShopLink
            item={item}
            outfitId={outfitId}
            className="mt-8 inline-flex items-center justify-center w-full sm:w-auto sm:min-w-[300px] border border-[#0A0A0A] text-[#0A0A0A] px-8 py-4 text-[11px] tracking-[0.16em] uppercase hover:bg-[#0A0A0A] hover:text-white transition-colors duration-300"
          >
            Go to retailer website →
          </ShopLink>
        )}
      </div>

      {/* Image — right on desktop, top on mobile. Two stacked layers cross-fade
          from the previous product to the new one, with a slow scale settle. */}
      <div className="order-1 sm:order-2">
        <div className="relative" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="relative aspect-[3/4] w-full bg-[#F7F7F5] overflow-hidden">
            {/* Outgoing product — sits underneath, faded out by the new one. */}
            {back && (
              <FallbackImage
                key={back}
                src={back}
                thumbWidth={1000}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-contain"
              />
            )}
            {/* Incoming product — fades in over the old one and settles in scale. */}
            {front && (
              <FallbackImage
                key={front}
                src={front}
                thumbWidth={1000}
                alt={item.product_name}
                className="absolute inset-0 w-full h-full object-contain will-change-transform"
                style={{
                  transition: entered ? 'opacity 620ms ease-out, transform 1200ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                  opacity: entered ? 1 : 0,
                  transform: entered ? 'scale(1)' : 'scale(1.045)',
                }}
              />
            )}

            {/* The full look, shown small at the top-right for context — tap to
                return to the outfit. */}
            {outfitImage && (
              <button
                type="button"
                onClick={onBackToOutfit}
                aria-label="Back to the full look"
                className="absolute top-3 right-3 z-20 w-[58px] sm:w-[76px] aspect-[3/4] rounded-md overflow-hidden border border-white shadow-[0_2px_10px_rgba(0,0,0,0.18)] hover:shadow-[0_3px_14px_rgba(0,0,0,0.28)] transition-shadow duration-300"
              >
                <FallbackImage src={outfitImage} thumbWidth={240} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            )}
          </div>
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={onPrev}
                aria-label="Previous photo"
                className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-8 flex items-center justify-center text-[#0A0A0A]/55 text-[32px] leading-none drop-shadow-[0_1px_3px_rgba(255,255,255,0.8)] hover:text-[#0A0A0A] transition-colors duration-200 z-20"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={onNext}
                aria-label="Next photo"
                className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 w-8 flex items-center justify-center text-[#0A0A0A]/55 text-[32px] leading-none drop-shadow-[0_1px_3px_rgba(255,255,255,0.8)] hover:text-[#0A0A0A] transition-colors duration-200 z-20"
              >
                ›
              </button>
            </>
          )}
        </div>

        {/* Mini looks tagged to this product — other live outfits styled with it.
            Fades/lifts in just after the main slide for a smooth cascade. */}
        {tagged.length > 0 && (
          <div
            className="mt-5"
            style={{
              transition: entered ? 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1) 220ms, opacity 700ms ease-out 220ms' : 'none',
              transform: entered ? 'translateY(0)' : 'translateY(14px)',
              opacity: entered ? 1 : 0,
            }}
          >
            <p className="text-[9px] tracking-[0.16em] uppercase text-[#A8A8A4] mb-2.5">Styled with this piece</p>
            <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1">
              {tagged.map((o) => (
                <button
                  key={o.outfit_id}
                  type="button"
                  onClick={() => router.push(`${linkBase}/${o.outfit_id}`)}
                  className="group flex-shrink-0 w-[66px] sm:w-[80px]"
                  aria-label="Open this look"
                >
                  <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-[#F2F2F0]">
                    {o.image_url && (
                      <FallbackImage
                        src={o.image_url}
                        thumbWidth={240}
                        alt={o.aesthetic_label ?? 'Look'}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}

// ── Detail view hotspot positions ────────────────────────────
function getDetailHotspotPosition(slot: string): { x: number; y: number } {
  const positions: Record<string, { x: number; y: number }> = {
    outerwear: { x: 50, y: 28 },
    top: { x: 44, y: 36 },
    bottom: { x: 50, y: 60 },
    dress: { x: 50, y: 48 },
    shoe: { x: 45, y: 87 },
    bag: { x: 28, y: 63 },
    jewellery: { x: 50, y: 20 },
    belt: { x: 50, y: 47 },
    accessory: { x: 50, y: 47 },
  }
  return positions[slot] ?? { x: 50, y: 50 }
}

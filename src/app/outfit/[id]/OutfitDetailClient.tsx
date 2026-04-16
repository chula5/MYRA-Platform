'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Hotspot from '@/components/hotspot/Hotspot'
import SourcePanel from '@/components/source-panel/SourcePanel'
import OutfitCard from '@/components/outfit-card/OutfitCard'
import CardButton from '@/components/ui/CardButton'
import { createClient } from '@/lib/supabase'
import type { OutfitWithItems, Item, Brand, ItemType } from '@/types/database'

type SourceItemData = Item & { brand: Brand }

interface OutfitDetailClientProps {
  outfitId: string
  styleItemId?: string
  itemType?: string
  mode?: 'similar' | 'explore'
}

export default function OutfitDetailClient({
  outfitId,
  styleItemId,
  itemType,
  mode,
}: OutfitDetailClientProps) {
  const router = useRouter()
  const [outfit, setOutfit] = useState<OutfitWithItems | null>(null)
  const [styleItemOutfits, setStyleItemOutfits] = useState<OutfitWithItems[]>([])
  const [relatedOutfits, setRelatedOutfits] = useState<OutfitWithItems[]>([])
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)
  const [activeStyleItemId, setActiveStyleItemId] = useState<string | null>(styleItemId ?? null)
  const [activeItemType, setActiveItemType] = useState<ItemType | null>(itemType as ItemType ?? null)
  const [loading, setLoading] = useState(true)

  // ── Fetch main outfit ─────────────────────────────────────
  useEffect(() => {
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
  }, [outfitId])

  // ── Fetch style item outfits ──────────────────────────────
  const fetchStyleItemOutfits = useCallback(async (itemId: string) => {
    const supabase = createClient()

    const { data: outfitItems } = await supabase
      .from('outfit_item')
      .select('outfit_id')
      .eq('item_id', itemId)
      .neq('outfit_id', outfitId)
      .limit(6)

    if (!outfitItems?.length) return

    const ids = outfitItems.map((oi) => oi.outfit_id)

    const { data } = await supabase
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
      .in('outfit_id', ids)
      .eq('status', 'live')
      .limit(3)

    setStyleItemOutfits((data ?? []) as OutfitWithItems[])
  }, [outfitId])

  // ── Fetch similar / explore outfits ───────────────────────
  const fetchRelatedOutfits = useCallback(async (
    currentOutfit: OutfitWithItems,
    fetchMode: 'similar' | 'explore'
  ) => {
    const supabase = createClient()

    let query = supabase
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
      .eq('status', 'live')
      .neq('outfit_id', currentOutfit.outfit_id)
      .limit(6)

    if (fetchMode === 'similar') {
      query = query
        .eq('formality', currentOutfit.formality)
        .overlaps('occasion_tags', currentOutfit.occasion_tags)
    } else {
      // Explore — same occasion, different construction/aesthetic
      query = query
        .overlaps('occasion_tags', currentOutfit.occasion_tags)
        .neq('construction', currentOutfit.construction)
    }

    const { data } = await query
    setRelatedOutfits((data ?? []) as OutfitWithItems[])
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
    setActiveStyleItemId(itemId)
    setActiveItemType(iType)
    setStyleItemOutfits([])
    fetchStyleItemOutfits(itemId)
  }

  const handleSimilarLooks = () => {
    if (outfit) fetchRelatedOutfits(outfit, 'similar')
  }

  const handleExploreStyles = () => {
    if (outfit) fetchRelatedOutfits(outfit, 'explore')
  }

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto px-10 py-12">
        <div className="aspect-[3/4] bg-[#F2F2F2] animate-pulse rounded-[2px]" />
      </div>
    )
  }

  if (!outfit) {
    return (
      <div className="text-center py-24 px-10">
        <p className="text-[11px] tracking-[0.25em] text-[#A8A8A4]">OUTFIT NOT FOUND</p>
        <button
          onClick={() => router.back()}
          className="mt-6 text-[11px] tracking-[0.20em] underline text-[#6B6B6B]"
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

  return (
    <div className="max-w-[1440px] mx-auto px-10 py-8">

      {/* ── Back + Nav ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => router.back()}
          className="text-[11px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 flex items-center gap-2"
        >
          ← BACK
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="text-[20px] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 leading-none"
          >
            ‹
          </button>
          <button
            className="text-[20px] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 leading-none"
          >
            ›
          </button>
        </div>
      </div>

      {/* ── Main outfit detail ────────────────────────────── */}
      <div className="max-w-[560px] mx-auto mb-12">
        {/* Outfit image with hotspots */}
        <ImageWithHotspots
          outfit={outfit}
          activeItemLabel={activeItemLabel}
          onStyleItem={handleStyleItem}
        />


        {/* Aesthetic label */}
        <p className="text-[15px] tracking-[0.18em] text-[#0A0A0A] mb-2">
          {outfit.aesthetic_label}
        </p>

        {/* Occasion tags */}
        {outfit.occasion_tags?.length > 0 && (
          <p className="text-[11px] tracking-[0.20em] text-[#6B6B6B] mb-5">
            {outfit.occasion_tags.join(' · ')}
          </p>
        )}

        {/* Action buttons — centred */}
        <div className="flex items-center justify-center gap-2">
          <CardButton variant="filled" onClick={() => setSourcePanelOpen(true)}>
            SOURCE ITEMS
          </CardButton>
          <CardButton variant="outlined" onClick={handleSimilarLooks}>
            SIMILAR LOOKS
          </CardButton>
          <CardButton variant="outlined" onClick={handleExploreStyles}>
            EXPLORE STYLES
          </CardButton>
        </div>
      </div>

      {/* ── Style Item results ─────────────────────────────── */}
      {activeStyleItemId && styleItemOutfits.length > 0 && (
        <div className="mt-16">
          {/* Spacer between original and results */}
          <div className="border-t border-[#E2E0DB] mb-12" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {styleItemOutfits.map((o) => (
              <OutfitCard
                key={o.outfit_id}
                outfit={o}
                onSimilarLooks={() => router.push(`/outfit/${o.outfit_id}?mode=similar`)}
                onExploreStyles={() => router.push(`/outfit/${o.outfit_id}?mode=explore`)}
                onStyleItem={(itemId, iType) => handleStyleItem(itemId, iType)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Similar / Explore results ──────────────────────── */}
      {relatedOutfits.length > 0 && !activeStyleItemId && (
        <div className="mt-16">
          <div className="border-t border-[#E2E0DB] mb-8" />
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-8 text-center">
            {mode === 'similar' ? 'SIMILAR LOOKS' : 'EXPLORE STYLES'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {relatedOutfits.map((o) => (
              <OutfitCard
                key={o.outfit_id}
                outfit={o}
                onSimilarLooks={() => router.push(`/outfit/${o.outfit_id}?mode=similar`)}
                onExploreStyles={() => router.push(`/outfit/${o.outfit_id}?mode=explore`)}
                onStyleItem={(itemId, iType) => handleStyleItem(itemId, iType)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Source panel */}
      <SourcePanel
        items={items}
        isOpen={sourcePanelOpen}
        onClose={() => setSourcePanelOpen(false)}
      />
    </div>
  )
}

// ── Image with hover-reveal hotspots ─────────────────────────
function ImageWithHotspots({
  outfit,
  activeItemLabel,
  onStyleItem,
}: {
  outfit: OutfitWithItems
  activeItemLabel: string | null
  onStyleItem: (itemId: string, itemType: ItemType) => void
}) {
  const [imageHovered, setImageHovered] = useState(false)

  return (
    <div
      className="relative aspect-[3/4] w-full overflow-hidden mb-4 bg-white"
      onMouseEnter={() => setImageHovered(true)}
      onMouseLeave={() => setImageHovered(false)}
    >
      <Image
        src={outfit.image_url || '/placeholder-outfit.jpg'}
        alt={outfit.aesthetic_label}
        fill
        priority
        className="object-contain"
        sizes="(max-width: 768px) 100vw, 560px"
      />

      {activeItemLabel && (
        <div className="absolute top-4 left-4 bg-white border border-[#0A0A0A] rounded-full px-3 py-1.5">
          <span className="text-[10px] tracking-[0.15em] text-[#0A0A0A]">
            STYLE {activeItemLabel} ↗
          </span>
        </div>
      )}

      {(outfit.outfit_item ?? []).filter((oi) => oi.item != null).map((oi) => {
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

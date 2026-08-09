'use server'

// STOCK SENTINEL — set-aware.
//
// HERO item dies → all outfits in its styling set pause TOGETHER; replacement
// logic runs once for the hero and the chosen replacement applies across the
// whole set (one decision, not four), then each affected variant re-renders
// sequentially through the normal render + fidelity pipeline.
//
// SUPPORTING item dies → only the affected variant pauses; the set stays live
// with its remaining variants. Under-styled flag applies when live variants
// drop below 2.

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, type ItemWithBrand } from '@/lib/admin-queries'
import { pairCompat, slotForItemType } from '@/lib/composer'
import { getReadyAndLiveItems } from '@/lib/admin-queries'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'
import { SET_MIN_LIVE } from '@/lib/styling-sets'
import { revalidatePath } from 'next/cache'

export interface PausedSet {
  styling_set_id: string
  hero_item_id: string
  hero_name: string
  hero_brand: string | null
  hero_image: string | null
  hero_stock: string | null
  variant_count: number
  paused_count: number
}

// ── The sweep ────────────────────────────────────────────────────────────────

export async function runStockSentinel(): Promise<{
  heroSetsPaused: number
  variantsPaused: number
  setsUnderStyled: number
  error?: string
}> {
  const admin = createAdminClient()
  try {
    const { data: dead } = await admin
      .from('item' as any)
      .select('item_id')
      .eq('stock_status', 'out_of_stock')
      .limit(20000)
    const deadIds = new Set(((dead ?? []) as any[]).map((r) => r.item_id))
    if (!deadIds.size) return { heroSetsPaused: 0, variantsPaused: 0, setsUnderStyled: 0 }

    let heroSetsPaused = 0
    let variantsPaused = 0
    let setsUnderStyled = 0

    // 1. HERO deaths: pause the whole set together.
    const { data: sets } = await admin
      .from('styling_set' as any)
      .select('styling_set_id, hero_item_id, status')
      .in('status', ['live', 'reviewing', 'under_styled'])
      .limit(5000)
    for (const s of (sets ?? []) as any[]) {
      if (!deadIds.has(s.hero_item_id)) continue
      const { data: outfits } = await admin
        .from('outfit' as any)
        .select('outfit_id, status')
        .eq('styling_set_id', s.styling_set_id)
        .in('status', ['live', 'in_review', 'draft'])
      const live = ((outfits ?? []) as any[]).filter((o) => o.status === 'live')
      for (const o of live) {
        await (admin.from('outfit') as any)
          .update({ status: 'draft', paused_reason: 'hero item out of stock', paused_from_status: o.status })
          .eq('outfit_id', o.outfit_id)
      }
      await (admin.from('styling_set') as any)
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('styling_set_id', s.styling_set_id)
      heroSetsPaused++
    }

    // 2. SUPPORTING deaths: pause only the affected live variants.
    const { data: oiRows } = await admin
      .from('outfit_item' as any)
      .select('outfit_id, item_id, slot')
      .in('item_id', [...Array.from(deadIds)])
      .limit(50000)
    const outfitIds = Array.from(new Set(((oiRows ?? []) as any[]).map((r) => r.outfit_id)))
    if (outfitIds.length) {
      const { data: outfits } = await admin
        .from('outfit' as any)
        .select('outfit_id, status, styling_set_id')
        .in('outfit_id', outfitIds)
        .eq('status', 'live')
      const touchedSets = new Set<string>()
      for (const o of (outfits ?? []) as any[]) {
        // Hero deaths already handled above (whole set paused).
        const { data: setRow } = o.styling_set_id
          ? await admin.from('styling_set' as any).select('hero_item_id, status').eq('styling_set_id', o.styling_set_id).maybeSingle()
          : { data: null }
        if ((setRow as any)?.status === 'paused') continue
        const heroId = (setRow as any)?.hero_item_id
        const deadInOutfit = ((oiRows ?? []) as any[]).filter((r) => r.outfit_id === o.outfit_id)
        const onlyHeroDead = heroId && deadInOutfit.every((r) => r.item_id === heroId)
        if (onlyHeroDead) continue
        await (admin.from('outfit') as any)
          .update({ status: 'draft', paused_reason: 'supporting item out of stock', paused_from_status: 'live' })
          .eq('outfit_id', o.outfit_id)
        variantsPaused++
        if (o.styling_set_id) touchedSets.add(o.styling_set_id)
      }
      // Under-styled: live variants dropped below 2.
      for (const setId of Array.from(touchedSets)) {
        const { data: live } = await admin
          .from('outfit' as any)
          .select('outfit_id', { count: 'exact', head: false })
          .eq('styling_set_id', setId)
          .eq('status', 'live')
        if (((live ?? []) as any[]).length < SET_MIN_LIVE) {
          await (admin.from('styling_set') as any)
            .update({ status: 'under_styled', updated_at: new Date().toISOString() })
            .eq('styling_set_id', setId)
          setsUnderStyled++
        }
      }
    }

    revalidatePath('/admin/stock-impact')
    return { heroSetsPaused, variantsPaused, setsUnderStyled }
  } catch (err) {
    console.error('[runStockSentinel]', err)
    return { heroSetsPaused: 0, variantsPaused: 0, setsUnderStyled: 0, error: err instanceof Error ? err.message : 'Sentinel failed' }
  }
}

// ── Paused sets + one-decision hero replacement ──────────────────────────────

export async function loadPausedSets(): Promise<PausedSet[]> {
  try {
    const admin = createAdminClient()
    const { data: sets } = await admin
      .from('styling_set' as any)
      .select('styling_set_id, hero_item_id')
      .eq('status', 'paused')
      .limit(200)
    const out: PausedSet[] = []
    for (const s of (sets ?? []) as any[]) {
      const [{ data: hero }, { data: outfits }] = await Promise.all([
        admin.from('item' as any).select('product_name, image_url, stock_status, brand(name)').eq('item_id', s.hero_item_id).maybeSingle(),
        admin.from('outfit' as any).select('outfit_id, status, paused_reason').eq('styling_set_id', s.styling_set_id),
      ])
      const os = (outfits ?? []) as any[]
      out.push({
        styling_set_id: s.styling_set_id,
        hero_item_id: s.hero_item_id,
        hero_name: (hero as any)?.product_name ?? '—',
        hero_brand: (hero as any)?.brand?.name ?? null,
        hero_image: (hero as any)?.image_url ?? null,
        hero_stock: (hero as any)?.stock_status ?? null,
        variant_count: os.length,
        paused_count: os.filter((o) => o.paused_reason).length,
      })
    }
    return out
  } catch {
    return []
  }
}

export interface HeroReplacementOption {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  compat: number
}

// Ranked replacements for a dead hero: same slot, in stock, most compatible
// with the outgoing hero (so the set's character survives the swap).
export async function getHeroReplacementOptions(stylingSetId: string): Promise<{ options: HeroReplacementOption[]; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: setRow } = await admin.from('styling_set' as any).select('hero_item_id').eq('styling_set_id', stylingSetId).maybeSingle()
    if (!setRow) return { options: [], error: 'Set not found' }
    const hero = await getItem((setRow as any).hero_item_id)
    if (!hero) return { options: [], error: 'Hero not found' }
    const heroSlot = slotForItemType(hero.item_type)
    const library = await getReadyAndLiveItems()
    const options = library
      .filter((it: any) =>
        it.item_id !== hero.item_id &&
        slotForItemType(it.item_type) === heroSlot &&
        it.stock_status !== 'out_of_stock',
      )
      .map((it) => ({
        item_id: it.item_id,
        product_name: it.product_name,
        brand_name: it.brand?.name ?? null,
        image_url: it.image_url,
        compat: Number(pairCompat(hero, it).total.toFixed(3)),
      }))
      .sort((a, b) => b.compat - a.compat)
      .slice(0, 24)
    return { options }
  } catch (err) {
    return { options: [], error: err instanceof Error ? err.message : 'Failed' }
  }
}

// ONE decision applied across the whole set: swap the hero in every variant,
// then re-render each affected variant sequentially (render + fidelity as
// always), restoring live status only after a successful render.
export async function applyHeroReplacement(
  stylingSetId: string,
  replacementItemId: string,
): Promise<{ swapped: number; error?: string }> {
  try {
    const admin = createAdminClient()
    const [{ data: setRow }, replacement] = await Promise.all([
      admin.from('styling_set' as any).select('hero_item_id, stylist_id').eq('styling_set_id', stylingSetId).maybeSingle(),
      getItem(replacementItemId),
    ])
    if (!setRow || !replacement) return { swapped: 0, error: 'Set or replacement not found' }
    const oldHeroId = (setRow as any).hero_item_id
    const newSlot = slotForItemType(replacement.item_type)

    const { data: outfits } = await admin
      .from('outfit' as any)
      .select('outfit_id, status, paused_from_status, image_url')
      .eq('styling_set_id', stylingSetId)
    const rows = (outfits ?? []) as any[]

    let swapped = 0
    for (const o of rows) {
      const { data: oi } = await admin
        .from('outfit_item' as any)
        .select('outfit_item_id, slot')
        .eq('outfit_id', o.outfit_id)
        .eq('item_id', oldHeroId)
        .maybeSingle()
      if (!oi) continue
      await (admin.from('outfit_item') as any).delete().eq('outfit_item_id', (oi as any).outfit_item_id)
      await (admin.from('outfit_item') as any).insert({
        outfit_id: o.outfit_id,
        item_id: replacementItemId,
        slot: newSlot,
        sort_order: 0,
      })
      swapped++
    }

    // The set follows the new hero.
    await (admin.from('styling_set') as any)
      .update({ hero_item_id: replacementItemId, status: 'reviewing', updated_at: new Date().toISOString() })
      .eq('styling_set_id', stylingSetId)

    // Sequential re-render of every affected variant (background; fidelity
    // check inside). Live status is restored per-variant on success.
    void (async () => {
      for (const o of rows) {
        try {
          const shot = await generateHiggsfieldShootForOutfit(o.outfit_id, 'F6')
          if (shot.imageUrl && o.paused_from_status === 'live') {
            await (admin.from('outfit') as any)
              .update({ status: 'live', paused_reason: null, paused_from_status: null })
              .eq('outfit_id', o.outfit_id)
          }
        } catch (err) {
          console.error('[applyHeroReplacement→render]', o.outfit_id, err)
        }
      }
      // Set status: live again if enough variants made it back.
      const { data: liveNow } = await admin
        .from('outfit' as any)
        .select('outfit_id')
        .eq('styling_set_id', stylingSetId)
        .eq('status', 'live')
      await (admin.from('styling_set') as any)
        .update({ status: ((liveNow ?? []) as any[]).length >= SET_MIN_LIVE ? 'live' : 'under_styled', updated_at: new Date().toISOString() })
        .eq('styling_set_id', stylingSetId)
    })()

    revalidatePath('/admin/stock-impact')
    return { swapped }
  } catch (err) {
    console.error('[applyHeroReplacement]', err)
    return { swapped: 0, error: err instanceof Error ? err.message : 'Replacement failed' }
  }
}

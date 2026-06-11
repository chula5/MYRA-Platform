'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import {
  slotForItemType,
  deriveSlotScores,
  deriveOutfitLevelScores,
  type Slot,
} from '@/lib/composer'
import type { ItemWithBrand } from '@/lib/admin-queries'

// Supabase PostgrestError objects aren't Error instances, so the default
// `err instanceof Error ? err.message : ...` pattern silently buries them as
// "Failed to ...". This pulls the real message + code/details/hint out of
// whatever shape we got handed.
function formatError(err: unknown, fallback: string): string {
  if (!err) return fallback
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string }
    const parts = [
      e.message,
      e.details && e.details !== e.message ? e.details : null,
      e.hint ? `hint: ${e.hint}` : null,
      e.code ? `(${e.code})` : null,
    ].filter(Boolean)
    if (parts.length > 0) return parts.join(' · ')
  }
  return fallback
}

function parseNullableInt(val: FormDataEntryValue | null): number | null {
  if (!val || val === '') return null
  const n = parseInt(val as string, 10)
  return isNaN(n) ? null : n
}

function extractItemFields(formData: FormData) {
  return {
    brand_id: (formData.get('brand_id') as string) || null,
    item_type: formData.get('item_type') as string,
    product_name: formData.get('product_name') as string,
    retailer_url: formData.get('retailer_url') as string,
    image_url: formData.get('image_url') as string,
    price: (formData.get('price') as string) || null,
    currency: (formData.get('currency') as string) || null,
    status: (formData.get('status') as string) || 'draft',
    admin_notes: (formData.get('admin_notes') as string) || null,
    notes: (formData.get('notes') as string) || null,
    in_inventory: formData.get('in_inventory') === 'on',
    source: (formData.get('source') as string) || 'manual',
    // Fit & shape
    fit: parseNullableInt(formData.get('fit')),
    length: parseNullableInt(formData.get('length')),
    rise: parseNullableInt(formData.get('rise')),
    structure: parseNullableInt(formData.get('structure')),
    shoulder: parseNullableInt(formData.get('shoulder')),
    waist_definition: parseNullableInt(formData.get('waist_definition')),
    leg_opening: parseNullableInt(formData.get('leg_opening')),
    // Surface & colour
    surface: parseNullableInt(formData.get('surface')),
    colour_depth: parseNullableInt(formData.get('colour_depth')),
    pattern: parseNullableInt(formData.get('pattern')),
    sheen: parseNullableInt(formData.get('sheen')),
    colour_hex: (formData.get('colour_hex') as string) || null,
    colour_family: (formData.get('colour_family') as string) || null,
    // Material
    material_category: (formData.get('material_category') as string) || null,
    material_weight: parseNullableInt(formData.get('material_weight')),
    material_formality: parseNullableInt(formData.get('material_formality')),
    material_primary: (formData.get('material_primary') as string) || null,
    // Jewellery
    jewellery_scale: parseNullableInt(formData.get('jewellery_scale')),
    jewellery_finish: (formData.get('jewellery_finish') as string) || null,
    jewellery_formality: parseNullableInt(formData.get('jewellery_formality')),
    jewellery_style: (formData.get('jewellery_style') as string) || null,
    jewellery_material_primary: (formData.get('jewellery_material_primary') as string) || null,
    jewellery_layering: formData.get('jewellery_layering') === 'on',
  }
}

async function logTasteEvent(
  itemId: string,
  event: 'created' | 'updated',
  fields: ReturnType<typeof extractItemFields>,
) {
  // Fire-and-forget — never block the main save on logging.
  try {
    const supabase = createAdminClient()
    let brand_name: string | null = null
    let brand_price_tier: number | null = null
    if (fields.brand_id) {
      const { data: brand } = await supabase
        .from('brand')
        .select('name, price_tier')
        .eq('brand_id', fields.brand_id)
        .single()
      if (brand) {
        brand_name = (brand as { name: string }).name
        brand_price_tier = (brand as { price_tier: number }).price_tier
      }
    }
    await supabase.from('taste_log').insert([
      {
        item_id: itemId,
        event_type: event,
        brand_id: fields.brand_id,
        brand_name,
        brand_price_tier,
        item_type: fields.item_type,
        colour_family: fields.colour_family,
        material_category: fields.material_category,
        fit: fields.fit,
        length: fields.length,
        structure: fields.structure,
        shoulder: fields.shoulder,
        waist_definition: fields.waist_definition,
        leg_opening: fields.leg_opening,
        surface: fields.surface,
        colour_depth: fields.colour_depth,
        pattern: fields.pattern,
        sheen: fields.sheen,
        material_weight: fields.material_weight,
        material_formality: fields.material_formality,
        admin_notes: fields.admin_notes,
      },
    ])
  } catch (err) {
    console.error('[logTasteEvent]', err)
  }
}

export async function createItem(formData: FormData): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const fields = extractItemFields(formData)
    const { data, error } = await supabase
      .from('item')
      .insert([fields])
      .select('item_id')
      .single()
    if (error) throw error
    if (data) await logTasteEvent((data as { item_id: string }).item_id, 'created', fields)
    revalidatePath('/admin/items')
    return {}
  } catch (err: unknown) {
    console.error('[createItem]', err)
    return { error: formatError(err, 'Failed to create item') }
  }
}

export async function updateItem(itemId: string, formData: FormData): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const fields = extractItemFields(formData)
    const { error } = await supabase.from('item').update(fields).eq('item_id', itemId)
    if (error) throw error
    await logTasteEvent(itemId, 'updated', fields)
    revalidatePath('/admin/items')
    revalidatePath(`/admin/items/${itemId}/edit`)
    return {}
  } catch (err: unknown) {
    console.error('[updateItem]', err)
    return { error: formatError(err, 'Failed to update item') }
  }
}

export async function updateItemStatus(
  itemId: string,
  status: 'draft' | 'ready' | 'live' | 'archived'
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase.from('item').update({ status }).eq('item_id', itemId)
    if (error) throw error
    revalidatePath('/admin/items')
    revalidatePath(`/admin/items/${itemId}/edit`)
    return {}
  } catch (err: unknown) {
    console.error('[updateItemStatus]', err)
    return { error: formatError(err, 'Failed to update status') }
  }
}

export async function createBrand(
  formData: FormData
): Promise<{ brandId?: string; error?: string }> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('brand')
      .insert([
        {
          name: formData.get('name') as string,
          price_tier: parseInt(formData.get('price_tier') as string, 10) || 3,
          era_orientation: parseInt(formData.get('era_orientation') as string, 10) || 3,
          aesthetic_output: parseInt(formData.get('aesthetic_output') as string, 10) || 3,
          cultural_legibility: parseInt(formData.get('cultural_legibility') as string, 10) || 3,
          creative_behaviour: parseInt(formData.get('creative_behaviour') as string, 10) || 3,
          notes: (formData.get('notes') as string) || null,
        },
      ])
      .select('brand_id')
      .single()
    if (error) throw error
    revalidatePath('/admin/items')
    revalidatePath('/admin/items/new')
    return { brandId: data.brand_id }
  } catch (err: unknown) {
    console.error('[createBrand]', err)
    return { error: formatError(err, 'Failed to create brand') }
  }
}

export async function updateBrand(
  brandId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase
      .from('brand')
      .update({
        name: formData.get('name') as string,
        price_tier: parseInt(formData.get('price_tier') as string, 10) || 3,
      })
      .eq('brand_id', brandId)
    if (error) throw error
    revalidatePath('/admin/items')
    return {}
  } catch (err: unknown) {
    console.error('[updateBrand]', err)
    return { error: formatError(err, 'Failed to update brand') }
  }
}

// ── Quick-build: turn selected library items into a draft outfit ───────────
// Triggered from the items grid SELECT ITEMS sticky bar. Bundles the chosen
// items into a new draft Outfit inside the auto-managed "Library drafts" bucket
// project, with slot scores pre-filled from each item's per-field scores. The
// cover image is picked by slot priority (dress > outerwear > top > rest).

const QUICKBUILD_PROJECT_TITLE = 'Library drafts'

export async function createOutfitFromSelectedItems(
  itemIds: string[],
): Promise<{ outfitId?: string; projectId?: string; error?: string }> {
  if (!itemIds || itemIds.length === 0) return { error: 'Select at least one item' }

  const supabase = createAdminClient()
  try {
    // Load each selected item with its brand
    const itemRows = await Promise.all(
      itemIds.map(async (id) => {
        const { data, error } = await supabase
          .from('item')
          .select('*, brand(*)')
          .eq('item_id', id)
          .single()
        if (error) return null
        return data as unknown as ItemWithBrand | null
      }),
    )

    if (itemRows.some((i) => !i)) return { error: 'One or more items not found' }
    const items = itemRows as ItemWithBrand[]

    // Derive slot per item from item_type
    const entries = items.map((item) => ({ item, slot: slotForItemType(item.item_type) }))

    // Cover image picked by slot priority — the most outfit-defining piece first
    const slotPriority: Slot[] = [
      'dress', 'outerwear', 'top', 'bottom', 'shoe', 'bag', 'jewellery', 'accessory',
    ]
    const sortedForCover = [...entries].sort(
      (a, b) => slotPriority.indexOf(a.slot) - slotPriority.indexOf(b.slot),
    )
    const cover = sortedForCover[0]

    // Ensure the "Library drafts" bucket project exists
    let projectId: string
    {
      const { data: existing } = await supabase
        .from('admin_project')
        .select('project_id')
        .eq('title', QUICKBUILD_PROJECT_TITLE)
        .eq('status', 'draft')
        .limit(1)
      const row = (existing ?? [])[0] as { project_id: string } | undefined
      if (row) {
        projectId = row.project_id
      } else {
        const { data: created, error: projErr } = await supabase
          .from('admin_project')
          .insert([{
            title: QUICKBUILD_PROJECT_TITLE,
            status: 'draft',
            outfit_ids: [],
            notes:
              'Auto-created bucket for outfits assembled by selecting items in the library. Move outfits into a named project before publishing.',
          }])
          .select('project_id')
          .single()
        if (projErr) throw projErr
        projectId = (created as { project_id: string }).project_id
      }
    }

    // Slot scores derived from the items themselves
    const slotScores = deriveSlotScores(entries)
    // Outfit-level averages — cover acts as the implicit anchor for averaging
    const additions = entries.filter((e) => e.item.item_id !== cover.item.item_id)
    const outfitLevel = deriveOutfitLevelScores(cover.item, additions)

    const allBrandIds = Array.from(
      new Set(entries.map((e) => e.item.brand_id).filter((id): id is string => !!id)),
    )

    const aestheticLabel = `LIBRARY BUILD · ${cover.item.product_name.toUpperCase()}`

    // Create the outfit
    const { data: outfit, error: outfitErr } = await supabase
      .from('outfit')
      .insert([{
        image_url: cover.item.image_url,
        aesthetic_label: aestheticLabel,
        occasion_tags: [],
        source_brand_ids: allBrandIds,
        status: 'draft',
        project_id: projectId,
        admin_notes:
          'Created from selected items in the library. Review and refine before publishing.',
        formality: 3, planning: 3, wearer_priority: 3, time_of_day: 3,
        ...outfitLevel,
        ...slotScores,
      }])
      .select('outfit_id')
      .single()
    if (outfitErr) throw outfitErr

    const outfitId = (outfit as { outfit_id: string }).outfit_id

    // Link items into outfit_item rows
    const outfitItemRows = entries.map((entry, idx) => ({
      outfit_id: outfitId,
      item_id: entry.item.item_id,
      slot: entry.slot,
      sort_order: idx,
    }))
    const { error: linkErr } = await supabase.from('outfit_item').insert(outfitItemRows)
    if (linkErr) throw linkErr

    // Append outfit_id to project.outfit_ids so the project view lists it
    const { data: project } = await supabase
      .from('admin_project')
      .select('outfit_ids')
      .eq('project_id', projectId)
      .single()
    const newIds = [
      ...((project as { outfit_ids: string[] } | null)?.outfit_ids ?? []),
      outfitId,
    ]
    await supabase
      .from('admin_project')
      .update({ outfit_ids: newIds })
      .eq('project_id', projectId)

    revalidatePath(`/admin/projects/${projectId}`)
    revalidatePath('/admin/items')
    return { outfitId, projectId }
  } catch (err: unknown) {
    console.error('[createOutfitFromSelectedItems]', err)
    return { error: formatError(err, 'Failed to create outfit') }
  }
}

// ── Delete items ──────────────────────────────────────────────────────────────
// Permanently delete one or more items. First removes any outfit_item links so
// there's no foreign-key violation / orphaned rows (this also removes the item
// from any outfits it was part of), then deletes the item rows.

export async function deleteItems(itemIds: string[]): Promise<{ ok?: boolean; count?: number; error?: string }> {
  const ids = (itemIds ?? []).filter(Boolean)
  if (ids.length === 0) return { error: 'No items selected' }

  const supabase = createAdminClient()
  try {
    // Unlink from any outfits first.
    const { error: linkErr } = await (supabase.from('outfit_item') as any).delete().in('item_id', ids)
    if (linkErr) throw linkErr

    const { error: itemErr } = await (supabase.from('item') as any).delete().in('item_id', ids)
    if (itemErr) throw itemErr

    revalidatePath('/admin/items')
    return { ok: true, count: ids.length }
  } catch (err: unknown) {
    console.error('[deleteItems]', err)
    return { error: formatError(err, 'Failed to delete items') }
  }
}

export async function deleteItem(itemId: string): Promise<{ ok?: boolean; error?: string }> {
  if (!itemId) return { error: 'No item id' }
  return deleteItems([itemId])
}

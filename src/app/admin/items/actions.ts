'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

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
    return { error: err instanceof Error ? err.message : 'Failed to create item' }
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
    return { error: err instanceof Error ? err.message : 'Failed to update item' }
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
    return { error: err instanceof Error ? err.message : 'Failed to update status' }
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
    return { brandId: data.brand_id }
  } catch (err: unknown) {
    console.error('[createBrand]', err)
    return { error: err instanceof Error ? err.message : 'Failed to create brand' }
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
    return { error: err instanceof Error ? err.message : 'Failed to update brand' }
  }
}

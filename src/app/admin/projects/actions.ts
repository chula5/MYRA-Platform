'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

function parseNullableInt(val: FormDataEntryValue | null): number | null {
  if (!val || val === '') return null
  const n = parseInt(val as string, 10)
  return isNaN(n) ? null : n
}

function parseRequiredInt(val: FormDataEntryValue | null, fallback = 3): number {
  if (!val || val === '') return fallback
  const n = parseInt(val as string, 10)
  return isNaN(n) ? fallback : n
}

function extractOutfitFields(formData: FormData) {
  const tagsRaw = formData.get('occasion_tags') as string
  const occasion_tags = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
    : []

  return {
    image_url: (formData.get('image_url') as string) || '',
    aesthetic_label: (formData.get('aesthetic_label') as string) || '',
    celebrity_name: (formData.get('celebrity_name') as string) || null,
    occasion_tags,
    admin_notes: (formData.get('admin_notes') as string) || null,
    // Required scores
    formality: parseRequiredInt(formData.get('formality')),
    planning: parseRequiredInt(formData.get('planning')),
    wearer_priority: parseRequiredInt(formData.get('wearer_priority')),
    time_of_day: parseRequiredInt(formData.get('time_of_day')),
    construction: parseRequiredInt(formData.get('construction')),
    surface_story: parseRequiredInt(formData.get('surface_story')),
    volume: parseRequiredInt(formData.get('volume')),
    colour_story: parseRequiredInt(formData.get('colour_story')),
    intent: parseRequiredInt(formData.get('intent')),
    // Outerwear (nullable)
    outerwear_construction: parseNullableInt(formData.get('outerwear_construction')),
    outerwear_volume: parseNullableInt(formData.get('outerwear_volume')),
    outerwear_material_weight: parseNullableInt(formData.get('outerwear_material_weight')),
    outerwear_material_formality: parseNullableInt(formData.get('outerwear_material_formality')),
    // Top (nullable)
    top_construction: parseNullableInt(formData.get('top_construction')),
    top_volume: parseNullableInt(formData.get('top_volume')),
    top_material_weight: parseNullableInt(formData.get('top_material_weight')),
    top_material_formality: parseNullableInt(formData.get('top_material_formality')),
    // Bottom (nullable)
    bottom_construction: parseNullableInt(formData.get('bottom_construction')),
    bottom_volume: parseNullableInt(formData.get('bottom_volume')),
    bottom_rise: parseNullableInt(formData.get('bottom_rise')),
    bottom_leg_opening: parseNullableInt(formData.get('bottom_leg_opening')),
    bottom_material_weight: parseNullableInt(formData.get('bottom_material_weight')),
    // Shoe (nullable)
    shoe_formality: parseNullableInt(formData.get('shoe_formality')),
    shoe_style: parseNullableInt(formData.get('shoe_style')),
    // Bag (nullable)
    bag_formality: parseNullableInt(formData.get('bag_formality')),
    // Jewellery (nullable)
    jewellery_scale: parseNullableInt(formData.get('jewellery_scale')),
    jewellery_formality: parseNullableInt(formData.get('jewellery_formality')),
  }
}

export async function createProject(
  formData: FormData
): Promise<{ projectId?: string; error?: string }> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from('admin_project')
      .insert([
        {
          title: formData.get('title') as string,
          notes: (formData.get('notes') as string) || null,
          cover_image_url: (formData.get('cover_image_url') as string) || null,
          status: 'draft',
          outfit_ids: [],
        },
      ])
      .select('project_id')
      .single()
    if (error) throw error
    revalidatePath('/admin/projects')
    return { projectId: data.project_id }
  } catch (err: unknown) {
    console.error('[createProject]', err)
    return { error: err instanceof Error ? err.message : 'Failed to create project' }
  }
}

export async function updateProject(
  projectId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase
      .from('admin_project')
      .update({
        title: formData.get('title') as string,
        notes: (formData.get('notes') as string) || null,
        cover_image_url: (formData.get('cover_image_url') as string) || null,
      })
      .eq('project_id', projectId)
    if (error) throw error
    revalidatePath('/admin/projects')
    revalidatePath(`/admin/projects/${projectId}`)
    return {}
  } catch (err: unknown) {
    console.error('[updateProject]', err)
    return { error: err instanceof Error ? err.message : 'Failed to update project' }
  }
}

export async function updateProjectStatus(
  projectId: string,
  status: 'draft' | 'in_review' | 'live' | 'archived'
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase
      .from('admin_project')
      .update({ status })
      .eq('project_id', projectId)
    if (error) throw error
    revalidatePath('/admin/projects')
    revalidatePath(`/admin/projects/${projectId}`)
    return {}
  } catch (err: unknown) {
    console.error('[updateProjectStatus]', err)
    return { error: err instanceof Error ? err.message : 'Failed to update project status' }
  }
}

export async function publishProject(projectId: string): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const now = new Date().toISOString()

    // Get all outfits in this project
    const { data: project, error: projectFetchError } = await supabase
      .from('admin_project')
      .select('outfit_ids')
      .eq('project_id', projectId)
      .single()

    if (projectFetchError) throw projectFetchError

    // Update all outfits to live
    if (project.outfit_ids && project.outfit_ids.length > 0) {
      const { error: outfitError } = await supabase
        .from('outfit')
        .update({ status: 'live', published_at: now })
        .in('outfit_id', project.outfit_ids)
      if (outfitError) throw outfitError
    }

    // Update project to live
    const { error: projectError } = await supabase
      .from('admin_project')
      .update({ status: 'live', published_at: now })
      .eq('project_id', projectId)
    if (projectError) throw projectError

    revalidatePath('/admin/projects')
    revalidatePath(`/admin/projects/${projectId}`)
    revalidatePath('/')
    return {}
  } catch (err: unknown) {
    console.error('[publishProject]', err)
    return { error: err instanceof Error ? err.message : 'Failed to publish project' }
  }
}

export async function createOutfit(
  projectId: string,
  formData: FormData
): Promise<{ outfitId?: string; error?: string }> {
  const supabase = createAdminClient()
  try {
    const fields = extractOutfitFields(formData)
    const status = (formData.get('status') as string) || 'draft'

    const { data: outfit, error: outfitError } = await supabase
      .from('outfit')
      .insert([
        {
          ...fields,
          status,
          project_id: projectId,
          source_brand_ids: [],
        },
      ])
      .select('outfit_id')
      .single()

    if (outfitError) throw outfitError

    // Add outfit_id to admin_project.outfit_ids array
    const { data: project, error: projectFetchError } = await supabase
      .from('admin_project')
      .select('outfit_ids')
      .eq('project_id', projectId)
      .single()

    if (projectFetchError) throw projectFetchError

    const newOutfitIds = [...(project.outfit_ids ?? []), outfit.outfit_id]

    const { error: updateError } = await supabase
      .from('admin_project')
      .update({ outfit_ids: newOutfitIds })
      .eq('project_id', projectId)

    if (updateError) throw updateError

    revalidatePath(`/admin/projects/${projectId}`)
    return { outfitId: outfit.outfit_id }
  } catch (err: unknown) {
    console.error('[createOutfit]', err)
    return { error: err instanceof Error ? err.message : 'Failed to create outfit' }
  }
}

export async function updateOutfit(
  outfitId: string,
  formData: FormData
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const fields = extractOutfitFields(formData)
    const status = formData.get('status') as string

    const { data: existing, error: fetchErr } = await supabase
      .from('outfit')
      .select('project_id')
      .eq('outfit_id', outfitId)
      .single()

    if (fetchErr) throw fetchErr

    const { error } = await supabase
      .from('outfit')
      .update({ ...fields, status: status || 'draft' })
      .eq('outfit_id', outfitId)
    if (error) throw error

    if (existing?.project_id) {
      revalidatePath(`/admin/projects/${existing.project_id}`)
      revalidatePath(`/admin/projects/${existing.project_id}/outfits/${outfitId}/edit`)
    }
    return {}
  } catch (err: unknown) {
    console.error('[updateOutfit]', err)
    return { error: err instanceof Error ? err.message : 'Failed to update outfit' }
  }
}

export async function addItemToOutfit(
  outfitId: string,
  itemId: string,
  slot: string
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase.from('outfit_item').insert([
      {
        outfit_id: outfitId,
        item_id: itemId,
        slot: slot as 'outerwear' | 'top' | 'bottom' | 'dress' | 'shoe' | 'bag' | 'jewellery' | 'accessory',
      },
    ])
    if (error) throw error

    // Get outfit's project_id for revalidation
    const { data: outfit } = await supabase
      .from('outfit')
      .select('project_id')
      .eq('outfit_id', outfitId)
      .single()

    if (outfit?.project_id) {
      revalidatePath(`/admin/projects/${outfit.project_id}/outfits/${outfitId}/edit`)
    }
    return {}
  } catch (err: unknown) {
    console.error('[addItemToOutfit]', err)
    return { error: err instanceof Error ? err.message : 'Failed to add item to outfit' }
  }
}

export async function quickAddItemToOutfit(
  outfitId: string,
  slot: string,
  itemType: string,
  productName: string,
  brandName: string,
  imageUrl: string,
  retailerUrl: string
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const SLOT_DEFAULT: Record<string, string> = {
    outerwear: 'coat', top: 'shirt', bottom: 'trousers',
    dress: 'midi_dress', shoe: 'heel', bag: 'tote',
    jewellery: 'necklace', accessory: 'belt',
  }
  try {
    console.log('[quickAddItemToOutfit] slot:', slot, 'itemType:', itemType)
    const safeItemType = itemType?.trim() || SLOT_DEFAULT[slot] || 'coat'
    // Find or create brand
    let brandId: string
    const trimmedBrand = brandName.trim()
    const { data: existingBrand } = trimmedBrand
      ? await supabase.from('brand').select('brand_id').ilike('name', trimmedBrand).maybeSingle()
      : { data: null }

    if (existingBrand) {
      brandId = existingBrand.brand_id
    } else {
      const { data: newBrand, error: brandError } = await supabase
        .from('brand')
        .insert([{
          name: brandName.trim() || 'Unknown',
          price_tier: 3,
          era_orientation: 3,
          aesthetic_output: 3,
          cultural_legibility: 3,
          creative_behaviour: 3,
        }])
        .select('brand_id')
        .single()
      if (brandError) throw brandError
      brandId = newBrand.brand_id
    }

    // Create item
    const { data: item, error: itemError } = await supabase
      .from('item')
      .insert([{
        brand_id: brandId,
        item_type: safeItemType,
        product_name: productName.trim() || slot,
        image_url: imageUrl.trim() || '',
        retailer_url: retailerUrl.trim() || '',
        status: 'live',
        source: 'manual',
        in_inventory: false,
      }])
      .select('item_id')
      .single()
    if (itemError) throw itemError

    // Link to outfit
    const { error: linkError } = await supabase.from('outfit_item').insert([{
      outfit_id: outfitId,
      item_id: item.item_id,
      slot,
    }])
    if (linkError) throw linkError

    const { data: outfit } = await supabase
      .from('outfit')
      .select('project_id')
      .eq('outfit_id', outfitId)
      .single()

    if (outfit?.project_id) {
      revalidatePath(`/admin/projects/${outfit.project_id}/outfits/${outfitId}/edit`)
    }
    return {}
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    console.error('[quickAddItemToOutfit] FULL ERROR:', msg)
    return { error: msg }
  }
}

export async function updateQuickItem(
  itemId: string,
  outfitId: string,
  productName: string,
  brandName: string,
  imageUrl: string,
  retailerUrl: string
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    // Find or create brand
    const trimmedBrand = brandName.trim()
    let brandId: string | undefined
    if (trimmedBrand) {
      const { data: existingBrand } = await supabase
        .from('brand')
        .select('brand_id')
        .ilike('name', trimmedBrand)
        .maybeSingle()
      if (existingBrand) {
        brandId = existingBrand.brand_id
      } else {
        const { data: newBrand, error: brandError } = await supabase
          .from('brand')
          .insert([{ name: trimmedBrand, price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3 }])
          .select('brand_id')
          .single()
        if (brandError) throw brandError
        brandId = newBrand.brand_id
      }
    }

    const updateFields: Record<string, string> = {
      product_name: productName.trim() || 'Untitled',
      image_url: imageUrl.trim() || '',
      retailer_url: retailerUrl.trim() || '',
      status: 'live',
    }
    if (brandId) updateFields.brand_id = brandId

    const { error } = await supabase.from('item').update(updateFields).eq('item_id', itemId)
    if (error) throw error

    const { data: outfit } = await supabase.from('outfit').select('project_id').eq('outfit_id', outfitId).single()
    if (outfit?.project_id) {
      revalidatePath(`/admin/projects/${outfit.project_id}/outfits/${outfitId}/edit`)
    }
    return {}
  } catch (err: unknown) {
    console.error('[updateQuickItem]', err)
    return { error: err instanceof Error ? err.message : 'Failed to update item' }
  }
}

export async function reorderOutfitItems(
  outfitId: string,
  orderedIds: string[]
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const results = await Promise.all(
      orderedIds.map((id, index) =>
        supabase.from('outfit_item').update({ sort_order: index }).eq('outfit_item_id', id)
      )
    )
    const firstError = results.find((r) => r.error)?.error
    if (firstError) throw firstError

    const { data: outfit } = await supabase
      .from('outfit')
      .select('project_id')
      .eq('outfit_id', outfitId)
      .single()
    if (outfit?.project_id) {
      revalidatePath(`/admin/projects/${outfit.project_id}/outfits/${outfitId}/edit`)
    }
    return {}
  } catch (err: unknown) {
    console.error('[reorderOutfitItems]', err)
    return { error: err instanceof Error ? err.message : JSON.stringify(err) }
  }
}

export async function removeItemFromOutfit(
  outfitItemId: string,
  outfitId: string
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase
      .from('outfit_item')
      .delete()
      .eq('outfit_item_id', outfitItemId)
    if (error) throw error

    const { data: outfit } = await supabase
      .from('outfit')
      .select('project_id')
      .eq('outfit_id', outfitId)
      .single()

    if (outfit?.project_id) {
      revalidatePath(`/admin/projects/${outfit.project_id}/outfits/${outfitId}/edit`)
    }
    return {}
  } catch (err: unknown) {
    console.error('[removeItemFromOutfit]', err)
    return { error: err instanceof Error ? err.message : 'Failed to remove item from outfit' }
  }
}

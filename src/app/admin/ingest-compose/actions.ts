'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { analyseProductUrl } from '@/app/admin/items/analyse-url'
import { scrapeAndUploadToCloudinary } from '@/app/admin/items/cloudinary-upload'
import { composeForAnchor, type ComposedCandidatePayload, type SlotPlanPayload } from '@/app/admin/composer/actions'
import { revalidatePath } from 'next/cache'

export interface IngestComposeResult {
  sourceUrl: string
  item?: { item_id: string; product_name: string; brand_name: string | null; image_url: string; price: string | null; item_type: string | null }
  candidates?: ComposedCandidatePayload[]
  slotPlan?: SlotPlanPayload
  error?: string
}

// Find an existing brand by name (case-insensitive), create it if missing, or
// fall back to the shared "Unknown" brand.
async function resolveBrandId(admin: ReturnType<typeof createAdminClient>, name: string | null): Promise<string> {
  const clean = (name ?? '').trim()
  if (clean) {
    const { data: existing } = await admin.from('brand').select('brand_id').ilike('name', clean).limit(1)
    const row = (existing ?? [])[0] as { brand_id: string } | undefined
    if (row) return row.brand_id
    const { data: created } = await admin
      .from('brand')
      .insert([{ name: clean, price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3 }] as any)
      .select('brand_id')
      .single()
    if (created) return (created as { brand_id: string }).brand_id
  }
  const { data: unk } = await admin.from('brand').select('brand_id').ilike('name', 'unknown').limit(1)
  const urow = (unk ?? [])[0] as { brand_id: string } | undefined
  if (urow) return urow.brand_id
  const { data: madeUnk } = await admin
    .from('brand')
    .insert([{ name: 'Unknown', price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3 }] as any)
    .select('brand_id')
    .single()
  return (madeUnk as any).brand_id
}

function fmtPrice(price: string | null, currency: string | null): string | null {
  if (!price) return null
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$' }
  const s = sym[currency ?? 'GBP'] ?? ''
  return `${s}${String(price).replace(/\.00$/, '')}`
}

// Analyse a product URL, create a READY item from it, and immediately compose
// outfit options anchored on it (same engine as the Composer).
export async function ingestAndComposeUrl(url: string): Promise<IngestComposeResult> {
  const sourceUrl = (url ?? '').trim()
  try {
    if (!/^https?:\/\//i.test(sourceUrl)) return { sourceUrl, error: 'Not a valid URL' }

    const res = await analyseProductUrl(sourceUrl)
    if (res.error || !res.data) return { sourceUrl, error: res.error ?? 'Could not read that product page' }
    const p = res.data
    const admin = createAdminClient()

    const brandId = await resolveBrandId(admin, p.brand_name)

    // Persist the image to Cloudinary (more reliable than hot-linking og:image).
    let imageUrl = ''
    try { const up = await scrapeAndUploadToCloudinary(sourceUrl); if (up.cloudinaryUrl) imageUrl = up.cloudinaryUrl } catch { /* fall back below */ }

    const insertRow = {
      brand_id: brandId,
      item_type: (p.item_type ?? 'blouse') as string,
      product_name: p.product_name ?? 'UNTITLED',
      retailer_url: sourceUrl,
      image_url: imageUrl,
      price: p.price, currency: p.currency,
      status: 'ready', source: 'web_discovery', in_inventory: false,
      fit: p.fit, length: p.length, rise: p.rise, structure: p.structure, shoulder: p.shoulder,
      waist_definition: p.waist_definition, leg_opening: p.leg_opening, surface: p.surface,
      colour_depth: p.colour_depth, pattern: p.pattern, sheen: p.sheen,
      colour_hex: p.colour_hex, colour_family: p.colour_family,
      material_category: p.material_category, material_weight: p.material_weight,
      material_formality: p.material_formality, material_primary: p.material_primary,
      jewellery_scale: p.jewellery_scale, jewellery_formality: p.jewellery_formality,
      admin_notes: 'Added via Add & Compose. Pre-scored by AI — refine before publishing.',
    }
    const { data: item, error: insErr } = await admin.from('item').insert([insertRow] as any).select('item_id').single()
    if (insErr || !item) return { sourceUrl, error: `Could not save item: ${insErr?.message ?? 'unknown'}` }
    const itemId = (item as { item_id: string }).item_id

    revalidatePath('/admin/items')

    // Compose outfit options anchored on the new item (existing engine).
    const comp = await composeForAnchor(itemId)
    return {
      sourceUrl,
      item: {
        item_id: itemId,
        product_name: p.product_name ?? 'UNTITLED',
        brand_name: p.brand_name ?? null,
        image_url: imageUrl,
        price: fmtPrice(p.price, p.currency),
        item_type: p.item_type,
      },
      candidates: comp.candidates,
      slotPlan: comp.slotPlan,
      error: comp.error,
    }
  } catch (err) {
    console.error('[ingestAndComposeUrl]', err)
    return { sourceUrl, error: err instanceof Error ? err.message : 'Failed' }
  }
}

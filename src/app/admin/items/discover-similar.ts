'use server'

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

interface DiscoveryCandidate {
  title: string
  brand_name: string | null
  retailer_url: string | null
  image_url: string | null
  price: string | null
  currency: string | null
  why_interesting: string | null
}

const SYSTEM_PROMPT = `You are a fashion buyer curating interesting pieces for a high-taste wardrobe assistant called MYRA. You have just seen an item the user loved and you're going to search the web for similar but distinct pieces they should also consider.

Your taste bar: editorial, directional, a little under-the-radar. Prefer independent and contemporary designers to big-box fast fashion. Avoid the obvious cookie-cutter options. The user already knows about the mainstream — surprise them.

For each suggestion return:
- title: the product name
- brand_name: the brand
- retailer_url: a real product URL you have verified in search results
- image_url: a direct image URL if you can find one, otherwise null
- price: the price as a number-only string (e.g. "420")
- currency: currency code (GBP, USD, EUR)
- why_interesting: one sentence on what makes this a compelling sibling to the source item

Return ONLY valid JSON, no markdown, no code fences:
{
  "candidates": [ 3-5 objects ]
}`

export async function discoverSimilarForItem(
  itemId: string,
): Promise<{ discovered?: number; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  const supabase = createAdminClient()

  try {
    // Load source item + brand
    const { data: item, error: fetchErr } = await supabase
      .from('item')
      .select('*, brand(name, price_tier)')
      .eq('item_id', itemId)
      .single()
    if (fetchErr) throw fetchErr
    if (!item) return { error: 'Item not found' }

    const i = item as unknown as {
      product_name: string
      item_type: string
      colour_family: string | null
      material_category: string | null
      material_primary: string | null
      fit: number | null
      length: number | null
      structure: number | null
      price: string | null
      currency: string | null
      brand: { name: string; price_tier: number } | null
    }

    const description = [
      `Source item: ${i.product_name}`,
      i.brand?.name && `Brand: ${i.brand.name}`,
      i.item_type && `Type: ${i.item_type.replace(/_/g, ' ')}`,
      i.colour_family && `Colour: ${i.colour_family}`,
      i.material_category && `Material: ${i.material_category.replace(/_/g, ' ')}`,
      i.material_primary && `Fabric: ${i.material_primary}`,
      i.fit != null && `Fit score: ${i.fit}/5`,
      i.length != null && `Length score: ${i.length}/5`,
      i.structure != null && `Structure score: ${i.structure}/5`,
      i.price && `Price: ${i.currency ?? ''} ${i.price}`,
      i.brand?.price_tier && `Price tier: ${i.brand.price_tier}/5`,
    ]
      .filter(Boolean)
      .join('\n')

    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 5,
        } as unknown as Anthropic.Messages.Tool,
      ],
      messages: [
        {
          role: 'user',
          content: `Find 3-5 similar but distinct pieces to this item. Search the web for real retailer listings.

${description}

Return the JSON now.`,
        },
      ],
    })

    // Find the final text block (there may be tool_use blocks before it)
    const textBlocks = response.content.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>
    if (textBlocks.length === 0) return { error: 'AI returned no text response' }
    const raw = textBlocks[textBlocks.length - 1].text
    const stripped = raw.replace(/```[a-z]*\n?/g, '').trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { error: 'AI returned invalid JSON' }

    const parsed = JSON.parse(jsonMatch[0]) as { candidates: DiscoveryCandidate[] }
    const candidates = parsed.candidates ?? []
    if (candidates.length === 0) return { error: 'No candidates found' }

    // Insert each candidate
    const rows = candidates.map((c) => ({
      source_item_id: itemId,
      title: c.title,
      brand_name: c.brand_name,
      retailer_url: c.retailer_url,
      image_url: c.image_url,
      price: c.price,
      currency: c.currency,
      why_interesting: c.why_interesting,
      status: 'new' as const,
    }))

    const { error: insertErr } = await supabase.from('discovered_item').insert(rows)
    if (insertErr) throw insertErr

    revalidatePath('/admin/discoveries')
    revalidatePath(`/admin/items/${itemId}/edit`)
    return { discovered: candidates.length }
  } catch (err: unknown) {
    console.error('[discoverSimilarForItem]', err)
    return { error: err instanceof Error ? err.message : 'Discovery failed' }
  }
}

export async function updateDiscoveryStatus(
  discoveredId: string,
  status: 'new' | 'saved' | 'dismissed',
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase
      .from('discovered_item')
      .update({ status })
      .eq('discovered_id', discoveredId)
    if (error) throw error
    revalidatePath('/admin/discoveries')
    return {}
  } catch (err: unknown) {
    console.error('[updateDiscoveryStatus]', err)
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
}

// Convert a discovery into a draft item in the library.
// Finds-or-creates the brand, inserts the item with whatever fields we have,
// and marks the discovery as 'saved'. Returns the new item_id so the caller
// can navigate to the edit page.
export async function saveDiscoveryAsItem(
  discoveredId: string,
): Promise<{ itemId?: string; error?: string }> {
  const supabase = createAdminClient()
  try {
    const { data: discovery, error: fetchErr } = await supabase
      .from('discovered_item')
      .select('*')
      .eq('discovered_id', discoveredId)
      .single()
    if (fetchErr) throw fetchErr
    if (!discovery) return { error: 'Discovery not found' }

    const d = discovery as unknown as {
      discovered_id: string
      title: string
      brand_name: string | null
      retailer_url: string | null
      image_url: string | null
      price: string | null
      currency: string | null
      why_interesting: string | null
    }

    // Find or create the brand
    let brandId: string | null = null
    const brandName = d.brand_name?.trim()
    if (brandName) {
      const { data: existing } = await supabase
        .from('brand')
        .select('brand_id')
        .ilike('name', brandName)
        .limit(1)
      const existingRow = (existing ?? [])[0] as { brand_id: string } | undefined
      if (existingRow) {
        brandId = existingRow.brand_id
      } else {
        const { data: created, error: createErr } = await supabase
          .from('brand')
          .insert([{
            name: brandName,
            price_tier: 3,
            era_orientation: 3,
            aesthetic_output: 3,
            cultural_legibility: 3,
            creative_behaviour: 3,
          }])
          .select('brand_id')
          .single()
        if (createErr) throw createErr
        brandId = (created as { brand_id: string } | null)?.brand_id ?? null
      }
    }

    if (!brandId) {
      // Fallback to a placeholder Unknown brand
      const { data: unknownBrand } = await supabase
        .from('brand')
        .select('brand_id')
        .ilike('name', 'unknown')
        .limit(1)
      const row = (unknownBrand ?? [])[0] as { brand_id: string } | undefined
      if (row) {
        brandId = row.brand_id
      } else {
        const { data: created, error: createErr } = await supabase
          .from('brand')
          .insert([{
            name: 'Unknown',
            price_tier: 3,
            era_orientation: 3,
            aesthetic_output: 3,
            cultural_legibility: 3,
            creative_behaviour: 3,
          }])
          .select('brand_id')
          .single()
        if (createErr) throw createErr
        brandId = (created as { brand_id: string } | null)?.brand_id ?? null
      }
    }

    if (!brandId) return { error: 'Could not resolve a brand for this item' }

    // Insert the item as a draft. The admin can refine item_type and the rest in the editor.
    const { data: inserted, error: insertErr } = await supabase
      .from('item')
      .insert([{
        brand_id: brandId,
        item_type: 'blouse', // placeholder — admin updates after review
        product_name: d.title,
        retailer_url: d.retailer_url ?? '',
        image_url: d.image_url ?? '',
        price: d.price,
        currency: d.currency,
        status: 'draft',
        source: 'web_discovery',
        in_inventory: false,
        admin_notes: d.why_interesting,
      }])
      .select('item_id')
      .single()
    if (insertErr) throw insertErr

    const itemId = (inserted as { item_id: string } | null)?.item_id
    if (!itemId) return { error: 'Item created but no ID returned' }

    // Mark discovery as saved
    await supabase
      .from('discovered_item')
      .update({ status: 'saved' })
      .eq('discovered_id', discoveredId)

    revalidatePath('/admin/items')
    revalidatePath('/admin/discoveries')
    return { itemId }
  } catch (err: unknown) {
    console.error('[saveDiscoveryAsItem]', err)
    return { error: err instanceof Error ? err.message : 'Save failed' }
  }
}

// Discover pieces from the aggregated taste profile (not tied to a single source item).
// Reads the taste_log, builds a prompt around the user's emerging pattern,
// and asks Claude to find new interesting pieces.
export async function discoverFromTasteProfile(): Promise<{ discovered?: number; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  const supabase = createAdminClient()

  try {
    const { data: logs, error: logErr } = await supabase
      .from('taste_log')
      .select('brand_name, brand_price_tier, item_type, colour_family, material_category')
      .order('logged_at', { ascending: false })
      .limit(200)
    if (logErr) throw logErr

    const rows = (logs ?? []) as Array<{
      brand_name: string | null
      brand_price_tier: number | null
      item_type: string | null
      colour_family: string | null
      material_category: string | null
    }>

    if (rows.length === 0) {
      return { error: 'No taste data yet — log some items first' }
    }

    // Aggregate
    const brandCounts = new Map<string, number>()
    const typeCounts = new Map<string, number>()
    const colourCounts = new Map<string, number>()
    const materialCounts = new Map<string, number>()
    const tierCounts = new Map<number, number>()

    for (const r of rows) {
      if (r.brand_name) brandCounts.set(r.brand_name, (brandCounts.get(r.brand_name) ?? 0) + 1)
      if (r.item_type) typeCounts.set(r.item_type, (typeCounts.get(r.item_type) ?? 0) + 1)
      if (r.colour_family) colourCounts.set(r.colour_family, (colourCounts.get(r.colour_family) ?? 0) + 1)
      if (r.material_category) materialCounts.set(r.material_category, (materialCounts.get(r.material_category) ?? 0) + 1)
      if (r.brand_price_tier != null) tierCounts.set(r.brand_price_tier, (tierCounts.get(r.brand_price_tier) ?? 0) + 1)
    }

    const top = (m: Map<string, number>, n = 5) =>
      Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
    const topTier = Array.from(tierCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]

    const topBrands = top(brandCounts, 8)
    const topTypes = top(typeCounts, 6)
    const topColours = top(colourCounts, 5)
    const topMaterials = top(materialCounts, 5)

    const profile = [
      `Brands they've been adding: ${topBrands.join(', ') || 'none'}`,
      `Item types they gravitate to: ${topTypes.join(', ') || 'any'}`,
      `Colour families: ${topColours.join(', ') || 'any'}`,
      `Materials: ${topMaterials.join(', ') || 'any'}`,
      topTier ? `Dominant price tier: ${topTier}/5` : '',
    ].filter(Boolean).join('\n')

    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 6,
        } as unknown as Anthropic.Messages.Tool,
      ],
      messages: [
        {
          role: 'user',
          content: `This is a user's emerging taste profile based on items they've saved to their wardrobe brain. Find 5-8 pieces they should consider — different brands they haven't tried yet but which fit this aesthetic. Don't repeat brands already in their profile unless there's a specific new collection worth flagging.

${profile}

Return the JSON now.`,
        },
      ],
    })

    const textBlocks = response.content.filter((b) => b.type === 'text') as Array<{ type: 'text'; text: string }>
    if (textBlocks.length === 0) return { error: 'AI returned no text response' }
    const raw = textBlocks[textBlocks.length - 1].text
    const stripped = raw.replace(/```[a-z]*\n?/g, '').trim()
    const jsonMatch = stripped.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { error: 'AI returned invalid JSON' }

    const parsed = JSON.parse(jsonMatch[0]) as { candidates: DiscoveryCandidate[] }
    const candidates = parsed.candidates ?? []
    if (candidates.length === 0) return { error: 'No candidates found' }

    const insertRows = candidates.map((c) => ({
      source_item_id: null,
      title: c.title,
      brand_name: c.brand_name,
      retailer_url: c.retailer_url,
      image_url: c.image_url,
      price: c.price,
      currency: c.currency,
      why_interesting: c.why_interesting,
      status: 'new' as const,
    }))

    const { error: insertErr } = await supabase.from('discovered_item').insert(insertRows)
    if (insertErr) throw insertErr

    revalidatePath('/admin/discoveries')
    return { discovered: candidates.length }
  } catch (err: unknown) {
    console.error('[discoverFromTasteProfile]', err)
    return { error: err instanceof Error ? err.message : 'Discovery failed' }
  }
}

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

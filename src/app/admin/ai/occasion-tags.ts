'use server'

import Anthropic from '@anthropic-ai/sdk'
import { getOutfit } from '@/lib/admin-queries'
import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

/**
 * Generate real-world occasion / season tags for an outfit from its ITEMS
 * collectively (materials → season, types + formality → event/setting) plus the
 * outfit-level scores. Deliberately item-based rather than image-based: the
 * editorial shoot is on a neutral studio background with no occasion context,
 * while the items carry the real signal — and this works before any image exists.
 *
 * Persists the tags to outfit.occasion_tags and returns them.
 *
 * @param opts.skipIfTagged  if true, leaves outfits that already have tags untouched
 *                           (used by the auto-trigger + backfill so manual tags aren't clobbered)
 */
export async function generateOccasionTags(
  outfitId: string,
  opts?: { skipIfTagged?: boolean },
): Promise<{ tags?: string[]; skipped?: boolean; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  const outfit = await getOutfit(outfitId)
  if (!outfit) return { error: 'Outfit not found' }

  const existing = ((outfit as any).occasion_tags ?? []) as string[]
  if (opts?.skipIfTagged && existing.length > 0) {
    return { tags: existing, skipped: true }
  }

  const items = ((outfit.outfit_item ?? []) as any[])
    .filter((oi) => oi.item)
    .map((oi) => {
      const it = oi.item
      const colour = it.colour_family ? `${it.colour_family} ` : ''
      const material = it.material_primary ? `${it.material_primary} ` : ''
      const type = (it.item_type ?? oi.slot ?? '').toString().replace(/_/g, ' ')
      const brand = it.brand?.name ? ` by ${it.brand.name}` : ''
      return `- ${colour}${material}${type}${brand}`.replace(/\s+/g, ' ').trim()
    })

  if (items.length === 0) return { error: 'Outfit has no items to read' }

  const o = outfit as any
  const { houseStyleBriefForPrompts } = await import('@/lib/house-style')
  const prompt = `You are a fashion stylist tagging an outfit with the real-world occasions, settings and seasons someone would actually wear it for.

${houseStyleBriefForPrompts()}
Occasion notes: Wimbledon reads as polished summer daytime, not literal whites. Date night skews dress- or skirt-led; dinner can go trouser-led.

OUTFIT SCORES (1-5):
- formality: ${o.formality ?? 3} (1=casual, 3=smart casual, 5=black tie)
- time of day: ${o.time_of_day ?? 3} (1=daytime, 5=night)

ITEMS:
${items.join('\n')}

Return ONLY a JSON array of 3 to 6 short, lowercase occasion/season tags that genuinely suit THESE specific pieces.

PRIMARY OCCASIONS — these are the filters in the app. Use the EXACT phrase for every one the outfit genuinely suits (include as many as fit):
- "weekend away"
- "summer office"  (polished, workplace-appropriate summer daywear — tailored / smart-casual in light fabrics; not too revealing, not black-tie)
- "wedding guest"
- "date night"
- "city summer evening"  (a polished but not black-tie summer evening look for the city — dinner / drinks / gallery)
- "casual summer weekend"  (relaxed, light, daytime summer pieces — easy weekend dressing)

You MAY also add a few extra season/setting tags from: "summer", "spring", "autumn", "winter", "holiday", "beach day", "garden party", "dinner", "lunch", "city break".

Rules:
- Infer SEASON from the materials: linen / cotton / lightweight / open sandals → spring/summer; wool / knitwear / heavy / boots / coats → autumn/winter.
- Infer the EVENT/SETTING from formality and time of day: higher formality + evening → "city summer evening" / "date night" / "wedding guest"; relaxed + daytime + light fabrics → "casual summer weekend" / "weekend away".
- A summer-fabric daytime look should almost always include "casual summer weekend"; a smarter summer-fabric evening look should include "city summer evening".
- Be specific and useful. Do NOT use vague tags like "casual", "everyday", "versatile" or "stylish".
- Only include occasions the outfit genuinely suits — do not over-reach.

Return just the array, e.g. ["casual summer weekend","summer","weekend away","lunch"]`

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const arrStr = raw.match(/\[[\s\S]*\]/)?.[0]
    if (!arrStr) return { error: 'AI returned no tags' }

    let parsed: unknown
    try { parsed = JSON.parse(arrStr) } catch { return { error: 'AI returned invalid JSON' } }
    if (!Array.isArray(parsed)) return { error: 'AI did not return an array' }

    const tags = Array.from(
      new Set(
        parsed
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ),
    ).slice(0, 6)

    if (tags.length === 0) return { error: 'No usable tags generated' }

    const admin = createAdminClient()
    const { error } = await (admin.from('outfit') as any)
      .update({ occasion_tags: tags })
      .eq('outfit_id', outfitId)
    if (error) throw error

    revalidatePath(`/admin/projects`)
    revalidatePath('/admin/the-edit')
    revalidatePath('/feed')
    return { tags }
  } catch (err: unknown) {
    console.error('[generateOccasionTags]', err)
    return { error: err instanceof Error ? err.message : 'Tag generation failed' }
  }
}

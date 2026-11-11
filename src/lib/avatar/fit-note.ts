// What a piece's product photo says about its length and fit, in one measured sentence, so the
// dressing model puts the hem where it belongs (Chloe, 2026-11-09: "this jacket is to my waist,
// not lower"). Read once per piece with the wardrobe's vision model and kept on the item.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { WARDROBE_CONFIG } from '@/lib/wardrobe/config'

const admin = () => createAdminClient() as any

const PROMPT = `Look at this product photo of one garment or pair of shoes. In ONE sentence of plain English, state exactly how it fits and where it ends on the body, measured against the body in the photo if someone is wearing it, or judged from its proportions if it is laid flat or on a hanger. Cover: length (where the hem ends: at the natural waist, hip bone, mid-thigh, knee, mid-calf, ankle; for sleeves: wrist, three-quarter, short, sleeveless), fit (fitted, straight, relaxed, oversized), and how it is fastened in the photo (open, buttoned, zipped, belted). For trousers, shorts and skirts also say what the waistband is: flat (tailored, with a zip, button or hook) or elasticated/drawstring — call it elasticated or drawstring ONLY when gathering or a cord is unmistakable at the FRONT of the waistband; many trousers are flat at the front with elastic only at the back, and from the front they read as a flat waistband, so when in doubt say "flat waistband". Be literal; do not add style words. Example: "A cropped sleeveless gilet that ends at the natural waist, relaxed fit, worn open." Example: "Relaxed wide-leg trousers that end at the ankle, flat waistband at the front."`

/** The item's fit note: stored one, or read now from its picture. Empty string if neither is possible. */
export async function fitNoteFor(item: { item_id: string; image_url: string | null; owned_metadata?: any }): Promise<string> {
  const stored = item.owned_metadata?.avatar_fit_note
  if (typeof stored === 'string' && stored.trim()) return stored.trim()
  if (!item.image_url || !process.env.OPENAI_API_KEY) return ''
  try {
    const note = await readFit(item.image_url)
    if (note) {
      const a = admin()
      const { data } = await a.from('item').select('owned_metadata').eq('item_id', item.item_id).maybeSingle()
      await a.from('item').update({ owned_metadata: { ...((data?.owned_metadata as any) ?? {}), avatar_fit_note: note } }).eq('item_id', item.item_id)
    }
    return note
  } catch (e) {
    console.error('[avatar] fit note', e instanceof Error ? e.message : e)
    return ''
  }
}

async function readFit(imageUrl: string): Promise<string> {
  const res = await fetch(`${WARDROBE_CONFIG.apiBase}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: WARDROBE_CONFIG.visionModel,
      input: [{ role: 'user', content: [{ type: 'input_text', text: PROMPT }, { type: 'input_image', image_url: imageUrl, detail: 'low' }] }],
      max_output_tokens: 120,
    }),
    signal: AbortSignal.timeout(40_000),
  })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message ?? `fit note ${res.status}`)
  const text: string = body.output_text ?? body.output?.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? '').join(' ') ?? ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

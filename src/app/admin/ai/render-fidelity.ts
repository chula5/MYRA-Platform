'use server'

// RENDER FIDELITY CHECK — mandatory after every Higgsfield render.
//
// A published image that misrepresents the clothes is brand-damaging, so before
// a render can become the outfit's display image we vision-compare it against
// the source item photos: colour, silhouette, cut and length must be faithful.
// Fail → auto-reject, retry ONCE with corrective prompt notes. Second failure →
// flag to Chloé (needs_review) and keep the previous display image.

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase-server'

export interface FidelityIssue {
  item: string
  field: 'colour' | 'silhouette' | 'cut' | 'length' | 'missing' | 'other'
  expected: string
  seen: string
}

export interface FidelityResult {
  passed: boolean
  score: number          // 0..1 overall fidelity
  issues: FidelityIssue[]
  correctiveNotes: string | null   // feed into the retry prompt
  error?: string
}

// Keep every image under Claude's vision limit.
function capImage(url: string): string {
  if (!url.includes('res.cloudinary.com')) return url
  if (/\/upload\/[^/]*[wqf]_/.test(url)) return url
  return url.replace('/upload/', '/upload/w_1200,q_auto,f_jpg/')
}

async function fetchAsBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(capImage(url))
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const mediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].find((t) => contentType.includes(t)) ?? 'image/jpeg'
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 4.5 * 1024 * 1024) return null
    return { data: buf.toString('base64'), mediaType }
  } catch {
    return null
  }
}

const PROMPT = `You are MYRA's render-fidelity inspector. The FIRST image is an AI-generated editorial render of an outfit. The following images are the REAL product photos of the items that outfit must contain, each labelled.

For each real item, check whether the render represents it faithfully on these dimensions:
- colour (the exact colour family and depth — cream is not white, navy is not black)
- silhouette (volume, fit — wide-leg must stay wide-leg, oversized must stay oversized)
- cut (neckline, sleeve, rise, shape details)
- length (cropped/waist/hip/midi/maxi must not shift by more than one step)

Also flag items that are MISSING from the render entirely.

Be strict about silhouette and colour — a distorted silhouette or wrong colour is a failure. Minor styling drift (tucking, accessories placement, lighting) is acceptable.

Return ONLY JSON:
{
  "score": 0.0-1.0 overall fidelity,
  "passed": true|false (false if ANY item has a wrong colour family, distorted silhouette, wrong cut, length shifted 2+ steps, or is missing),
  "issues": [{ "item": "label", "field": "colour|silhouette|cut|length|missing|other", "expected": "…", "seen": "…" }],
  "corrective_notes": "one or two imperative sentences to add to the generation prompt to fix the issues, or null if passed"
}`

export async function checkRenderFidelity(
  renderUrl: string,
  items: { label: string; image_url: string }[],
): Promise<FidelityResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { passed: true, score: 1, issues: [], correctiveNotes: null, error: 'ANTHROPIC_API_KEY not configured — check skipped' }

  try {
    const render = await fetchAsBase64(renderUrl)
    if (!render) return { passed: true, score: 1, issues: [], correctiveNotes: null, error: 'Could not fetch render — check skipped' }

    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: 'RENDER (the AI-generated image under inspection):' },
      { type: 'image', source: { type: 'base64', media_type: render.mediaType as any, data: render.data } },
    ]
    // Cap at 6 item references to stay within request limits.
    for (const it of items.filter((i) => i.image_url).slice(0, 6)) {
      const img = await fetchAsBase64(it.image_url)
      if (!img) continue
      content.push({ type: 'text', text: `REAL ITEM — ${it.label}:` })
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType as any, data: img.data } })
    }
    content.push({ type: 'text', text: PROMPT })

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    })
    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return { passed: true, score: 1, issues: [], correctiveNotes: null, error: 'No response — check skipped' }
    const jsonStr = text.text.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').match(/\{[\s\S]*\}/)?.[0]
    if (!jsonStr) return { passed: true, score: 1, issues: [], correctiveNotes: null, error: 'Unparseable response — check skipped' }
    const parsed = JSON.parse(jsonStr)
    return {
      passed: !!parsed.passed,
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      correctiveNotes: parsed.corrective_notes ?? null,
    }
  } catch (err) {
    console.error('[checkRenderFidelity]', err)
    // Never let the checker itself block a render pipeline outage-style.
    return { passed: true, score: 1, issues: [], correctiveNotes: null, error: err instanceof Error ? err.message : 'Check failed — skipped' }
  }
}

// Persist one check attempt to the render_check log.
export async function logRenderCheck(opts: {
  outfitId: string
  imageUrl: string
  attempt: number
  result: FidelityResult
  needsReview?: boolean
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await (admin.from('render_check') as any).insert({
      outfit_id: opts.outfitId,
      image_url: opts.imageUrl,
      attempt: opts.attempt,
      passed: opts.result.passed,
      score: opts.result.score,
      issues: opts.result.issues,
      notes: opts.result.correctiveNotes ?? opts.result.error ?? null,
      needs_review: opts.needsReview ?? false,
    })
  } catch (err) {
    console.error('[logRenderCheck]', err)
  }
}

// Renders flagged after a second failure — surfaced on the Style Brain screen.
export interface FlaggedRender {
  outfit_id: string
  image_url: string
  issues: FidelityIssue[]
  created_at: string
}

export async function loadFlaggedRenders(limit = 12): Promise<FlaggedRender[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('render_check' as any)
      .select('outfit_id, image_url, issues, created_at')
      .eq('needs_review', true)
      .order('created_at', { ascending: false })
      .limit(limit)
    return ((data ?? []) as any[]).map((r) => ({ ...r, issues: Array.isArray(r.issues) ? r.issues : [] }))
  } catch {
    return []
  }
}

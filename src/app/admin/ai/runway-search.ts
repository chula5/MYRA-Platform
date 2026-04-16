'use server'

import Anthropic from '@anthropic-ai/sdk'

export interface RunwayLook {
  letter: string
  brand: string
  season: string
  mood: string
  description: string
  whyInteresting: string
  sourceUrl: string
  imageUrls: string[]
}

export interface RunwaySearchResult {
  looks: RunwayLook[]
  summary: string
}

const SYSTEM_PROMPT = `You are a fashion editor and runway curator for MYRA, a fashion discovery platform. Your job is to surface the strongest runway looks from current collections.

When given a search query (brand, season, or open), return a JSON shortlist of 4–6 looks.

Each look must include:
- letter: "A", "B", "C", etc.
- brand: brand name
- season: e.g. "AW26", "SS26"
- mood: 2-3 word editorial descriptor (e.g. "quiet authority", "louche glamour")
- description: specific garment description — NOT vague. E.g. "oversized single-breasted blazer in Almodóvar red with stiff enlarged proportions worn open over minimal tailored shorts"
- whyInteresting: one sentence on the content/cultural hook
- sourceUrl: the Vogue or tag-walk gallery URL for this collection (e.g. https://www.vogue.com/fashion-shows/fall-2026-ready-to-wear/loewe)
- imageUrls: empty array []

Return ONLY valid JSON, no markdown, no code fences:
{
  "summary": "One sentence overview",
  "looks": [array of look objects]
}`

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
}

/** Scrape up to 4 images for a brand/season from tag-walk then Vogue */
export async function fetchLookImages(brand: string, season: string): Promise<string[]> {
  const images: string[] = []

  try {
    const seasonSlug = seasonToTagWalkSlug(season)
    const brandSlug = brand.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const url = `https://www.tag-walk.com/en/collection/woman/${brandSlug}/${seasonSlug}`
    const res = await fetch(url, { headers: SCRAPE_HEADERS, signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const html = await res.text()
      const matches = Array.from(html.matchAll(/data-src="(https:\/\/cdn\.tag-walk\.com\/list\/[^"]+)"/g))
      const urls = matches.map(m => m[1]).filter(Boolean)
      const picks = [urls[0], urls[4], urls[9], urls[14]].filter(Boolean) as string[]
      images.push(...picks)
    }
  } catch { /* continue */ }

  if (images.length < 2) {
    try {
      const brandSlug = brand.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      const s = season.toUpperCase()
      const seasonPath = s.includes('AW26') || s.includes('FW26') ? 'fall-2026-ready-to-wear'
        : s.includes('SS26') ? 'spring-2026-ready-to-wear'
        : 'fall-2026-ready-to-wear'
      const url = `https://www.vogue.com/fashion-shows/${seasonPath}/${brandSlug}`
      const res = await fetch(url, { headers: SCRAPE_HEADERS, signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const html = await res.text()
        const matches = Array.from(html.matchAll(/https:\/\/assets\.vogue\.com\/photos\/[a-zA-Z0-9]+\/master\/[^"'\s,]+\.jpg/g))
        const unique = Array.from(new Set(matches.map(m => m[0])))
        images.push(...unique.slice(0, 4 - images.length))
      }
    } catch { /* continue */ }
  }

  return images.slice(0, 4)
}

function seasonToTagWalkSlug(season: string): string {
  const s = season.toUpperCase()
  if (s.includes('AW26') || s.includes('FW26') || (s.includes('FALL') && s.includes('26'))) return 'fall-winter-2026'
  if (s.includes('SS26') || s.includes('SP26') || (s.includes('SPRING') && s.includes('26'))) return 'spring-summer-2026'
  if (s.includes('AW25') || s.includes('FW25')) return 'fall-winter-2025'
  if (s.includes('SS25')) return 'spring-summer-2025'
  return 'fall-winter-2026'
}

export async function searchRunwayLooks(query: string): Promise<{ data?: RunwaySearchResult; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Find the best runway looks for: "${query}"

Today: ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.
Current season: AW26 (Autumn/Winter 2026). Default to AW26 when user says "latest", "fall", or "current".

Return the JSON shortlist now.`
      }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return { error: 'No response from AI' }

    let raw = textBlock.text.trim()
    raw = raw.replace(/```[a-z]*\n?/g, '').trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { error: 'AI returned invalid JSON — try again' }

    const data = JSON.parse(jsonMatch[0]) as RunwaySearchResult
    return { data }
  } catch (err) {
    console.error('[searchRunwayLooks]', err)
    if (err instanceof SyntaxError) return { error: 'AI returned invalid JSON — try again' }
    return { error: err instanceof Error ? err.message : 'Search failed' }
  }
}

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

/** Scrape up to 4 images for a brand/season from tag-walk */
export async function fetchLookImages(brand: string, season: string): Promise<string[]> {
  try {
    const seasonSlug = seasonToTagWalkSlug(season)
    const brandSlug = brand.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const url = `https://www.tag-walk.com/en/collection/woman/${brandSlug}/${seasonSlug}`

    console.log('[fetchLookImages] fetching', url)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(url, { headers: SCRAPE_HEADERS, signal: controller.signal })
    clearTimeout(timer)

    console.log('[fetchLookImages] status', res.status, 'for', brand)

    if (!res.ok) return []

    const html = await res.text()
    const matches = Array.from(html.matchAll(/data-src="(https:\/\/cdn\.tag-walk\.com\/list\/[^"]+)"/g))
    const urls = matches.map(m => m[1]).filter(Boolean)

    console.log('[fetchLookImages] found', urls.length, 'images for', brand)

    return [urls[0], urls[4], urls[9], urls[14]].filter(Boolean) as string[]
  } catch (err) {
    console.error('[fetchLookImages] failed for', brand, err)
    return []
  }
}

function seasonToTagWalkSlug(season: string): string {
  const s = season.toUpperCase()
  if (s.includes('AW26') || s.includes('FW26') || (s.includes('FALL') && s.includes('26'))) return 'fall-winter-2026'
  if (s.includes('SS26') || s.includes('SP26') || (s.includes('SPRING') && s.includes('26'))) return 'spring-summer-2026'
  if (s.includes('AW25') || s.includes('FW25')) return 'fall-winter-2025'
  if (s.includes('SS25')) return 'spring-summer-2025'
  return 'fall-winter-2026'
}

export async function searchRunwayLooksWithImages(query: string): Promise<{ data?: RunwaySearchResult; error?: string }> {
  const res = await searchRunwayLooks(query)
  if (res.error || !res.data) return res

  // Fetch images for all looks in parallel server-side
  const looksWithImages = await Promise.all(
    res.data.looks.map(async (look) => {
      const imageUrls = await fetchLookImages(look.brand, look.season)
      return { ...look, imageUrls }
    })
  )

  return { data: { ...res.data, looks: looksWithImages } }
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

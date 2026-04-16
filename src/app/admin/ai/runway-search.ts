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
  imageQueries: string[]
  imageUrl?: string
}

export interface RunwaySearchResult {
  looks: RunwayLook[]
  summary: string
}

const SYSTEM_PROMPT = `You are a fashion editor and runway curator for MYRA, a fashion discovery platform. Your job is to research and surface the strongest runway looks from current collections.

When given a search query (brand, season, or open), you will:
1. Think carefully about which 4-6 looks from that brand/season would make the strongest editorial content
2. Return a JSON object with a shortlist of looks

Each look must include:
- letter: "A", "B", "C", etc.
- brand: brand name
- season: e.g. "AW26", "SS26"
- mood: 2-3 word editorial descriptor (e.g. "quiet authority", "louche glamour")
- description: specific garment description — NOT vague. E.g. "oversized single-breasted blazer in Almodóvar red with stiff enlarged proportions worn open over minimal tailored shorts" NOT "a red blazer"
- whyInteresting: one sentence on the content/cultural hook
- sourceUrl: the Vogue, WWD, or tag-walk gallery URL for this collection (e.g. https://www.vogue.com/fashion-shows/fall-2026-ready-to-wear/loewe)
- imageQueries: array of exactly 4 specific Google Image search strings to find this look, each slightly different angle:
  1. Exact look number e.g. "Loewe fall 2026 look 14 runway"
  2. Key garment focus e.g. "Loewe AW26 oxblood leather trench coat runway Paris"
  3. Vogue gallery search e.g. "Loewe fall 2026 ready to wear vogue runway"
  4. Editorial/wider search e.g. "Loewe AW26 collection highlights leather outerwear"

Prioritise: strong visual identity, wearable translation potential, content narrative, editorial aesthetic (quiet luxury, minimalist, considered).

Return ONLY valid JSON in this exact format:
{
  "summary": "One sentence overview of what you found",
  "looks": [array of look objects]
}

No markdown, no explanation, no code fences.`

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
}

/** Scrape up to 4 images for a look from tag-walk and Vogue */
export async function fetchLookImages(
  brand: string,
  season: string,  // e.g. "AW26"
): Promise<string[]> {
  const images: string[] = []

  // 1. Tag-walk — most complete, all looks in static HTML
  try {
    const seasonSlug = seasonToTagWalkSlug(season)
    const brandSlug = brand.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const tagwalkUrl = `https://www.tag-walk.com/en/collection/woman/${brandSlug}/${seasonSlug}`

    const res = await fetch(tagwalkUrl, { headers: SCRAPE_HEADERS })
    if (res.ok) {
      const html = await res.text()
      // Tag-walk stores images as data-src="https://cdn.tag-walk.com/list/..."
      const matches = Array.from(html.matchAll(/data-src="(https:\/\/cdn\.tag-walk\.com\/list\/[^"]+)"/g))
      const urls = matches.map(m => m[1]).filter(Boolean)
      // Take looks 1, 5, 10, 15 for variety
      const picks = [urls[0], urls[4], urls[9], urls[14]].filter(Boolean) as string[]
      images.push(...picks)
    }
  } catch { /* continue */ }

  // 2. Vogue — high quality, named look files
  if (images.length < 4) {
    try {
      const vogueUrl = sourceUrlFromBrandSeason(brand, season)
      const res = await fetch(vogueUrl, { headers: SCRAPE_HEADERS })
      if (res.ok) {
        const html = await res.text()
        // Vogue includes full CDN URLs in initial HTML for first ~6 looks
        const matches = Array.from(html.matchAll(/https:\/\/assets\.vogue\.com\/photos\/[a-zA-Z0-9]+\/master\/[^"'\s,]+\.jpg/g))
        const unique = Array.from(new Set(matches.map(m => m[0]))).filter(u => u.includes('ready-to-wear') || u.includes('fall') || u.includes('spring'))
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

function sourceUrlFromBrandSeason(brand: string, season: string): string {
  const brandSlug = brand.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const s = season.toUpperCase()
  if (s.includes('AW26') || s.includes('FW26')) return `https://www.vogue.com/fashion-shows/fall-2026-ready-to-wear/${brandSlug}`
  if (s.includes('SS26')) return `https://www.vogue.com/fashion-shows/spring-2026-ready-to-wear/${brandSlug}`
  if (s.includes('AW25') || s.includes('FW25')) return `https://www.vogue.com/fashion-shows/fall-2025-ready-to-wear/${brandSlug}`
  return `https://www.vogue.com/fashion-shows/fall-2026-ready-to-wear/${brandSlug}`
}

export async function searchRunwayLooks(query: string): Promise<{ data?: RunwaySearchResult; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Search for runway looks based on this request: "${query}"

Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.
Current season focus: AW26 (Autumn/Winter 2026) — the AW26 shows took place in February/March 2026 and are the most current collections. SS26 is the previous season. When the user says "latest" or "new" or "current", default to AW26.

Return 4-6 of the strongest looks as JSON.`,
        },
      ],
      system: SYSTEM_PROMPT,
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return { error: 'No response from AI' }

    let raw = textBlock.text.trim()
    if (raw.startsWith('```')) raw = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim()

    const data = JSON.parse(raw) as RunwaySearchResult
    return { data }
  } catch (err) {
    console.error('[searchRunwayLooks]', err)
    if (err instanceof SyntaxError) return { error: 'AI returned invalid JSON — try again' }
    return { error: err instanceof Error ? err.message : 'Search failed' }
  }
}

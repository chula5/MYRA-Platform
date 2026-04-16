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

const SYSTEM_PROMPT = `You are a fashion editor and runway curator for MYRA, a fashion discovery platform.

When given a search query, use web_search to find real runway imagery and editorial coverage, then return a curated shortlist of 4–6 looks.

For each look you must:
1. Search for the collection on Vogue, WWD, or tag-walk to get real image URLs
2. Find direct image URLs (preferably from assets.vogue.com, cdn.tag-walk.com, or wwd.com CDN)
3. Include the source gallery URL

Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "One sentence overview of what you found",
  "looks": [
    {
      "letter": "A",
      "brand": "Brand Name",
      "season": "AW26",
      "mood": "2-3 word editorial descriptor",
      "description": "Specific garment description — not vague. E.g. 'oversized single-breasted blazer in Almodóvar red with stiff enlarged proportions worn open over minimal tailored shorts'",
      "whyInteresting": "One sentence on the content/cultural hook",
      "sourceUrl": "https://www.vogue.com/fashion-shows/fall-2026-ready-to-wear/brand",
      "imageUrls": ["direct image url 1", "direct image url 2", "direct image url 3", "direct image url 4"]
    }
  ]
}

imageUrls must be real, direct image URLs you found via search — not placeholders. Prefer assets.vogue.com, cdn.tag-walk.com, or wwd.com image CDN URLs. If you can only find 1-2 real image URLs, that is fine — do not fabricate URLs.`

export async function searchRunwayLooks(query: string): Promise<{ data?: RunwaySearchResult; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY not configured' }

  const client = new Anthropic({ apiKey })

  const userMessage = `Search for runway looks: "${query}"

Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.
Current season: AW26 (Autumn/Winter 2026) — shows were February/March 2026. When user says "latest" or "current", use AW26.

Use web_search to find editorial coverage and real image URLs for 4–6 strong looks, then return ONLY the JSON shortlist.`

  try {
    const messages: any[] = [{ role: 'user', content: userMessage }]
    const tools: any[] = [{ type: 'web_search_20250305', name: 'web_search' }]

    let response: any = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      tools,
      messages,
      system: SYSTEM_PROMPT,
    })

    // Loop until Claude stops using tools and gives us the final text
    while (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content })
      // web_search_20250305 is server-executed — results are in the tool_result blocks automatically
      const toolResults = response.content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({ type: 'tool_result', tool_use_id: b.id, content: b.content ?? '' }))
      messages.push({ role: 'user', content: toolResults })

      response = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        tools,
        messages,
        system: SYSTEM_PROMPT,
      })
    }

    const textBlock = response.content.filter((b: any) => b.type === 'text').pop() as any
    if (!textBlock) return { error: 'No response from AI' }

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

'use server'

// Does a learned pattern agree with the style profile it wants to join?
//
// A pattern that recurs three times for one client is ready to become a rule
// for her STYLE — but only if it is consistent with what that style actually
// looks like. Without this check, a client drifting away from her profile
// writes her drift into the profile, and the next client matched to it
// inherits one person's change of mind as if it were the style.
//
// The moodboard is the reference because it is the one thing about a profile
// that was never derived from her decisions.

import Anthropic from '@anthropic-ai/sdk'
import { fetchImageForVision } from '@/lib/vision-image'

export type PatternVerdict = 'consistent' | 'inconsistent' | 'unclear'

const PROMPT = (pattern: string) => `These images are the reference moodboard for one styling profile.

A rule has been learned from one client's edits: "${pattern}".

Is that rule consistent with the style these images show?

Answer with exactly one word:
- consistent — the moodboard supports it, or is simply silent on it
- inconsistent — the moodboard clearly shows the OPPOSITE
- unclear — the images do not let you judge

Be generous with "consistent": a rule the moodboard says nothing about is not a
contradiction, and refusing those would stop the profile ever learning. Reserve
"inconsistent" for a rule that the reference images plainly contradict.`

export async function checkPatternAgainstMoodboard(
  patternLabel: string,
  imageUrls: string[],
): Promise<{ verdict: PatternVerdict; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { verdict: 'unclear', error: 'ANTHROPIC_API_KEY not configured' }
  const urls = imageUrls.filter(Boolean).slice(0, 4)
  if (!urls.length) return { verdict: 'unclear', error: 'no reference images' }

  try {
    const images = (await Promise.all(urls.map((u) => fetchImageForVision(u))))
      .map((r) => r.image).filter(Boolean)
    if (!images.length) return { verdict: 'unclear', error: 'reference images could not be read' }

    const client = new Anthropic({ apiKey })
    const r = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{
        role: 'user',
        content: [
          ...images.map((im) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: im!.mediaType, data: im!.data },
          })),
          { type: 'text' as const, text: PROMPT(patternLabel) },
        ],
      }],
    })
    const block = r.content.find((b) => b.type === 'text')
    const word = (block && block.type === 'text' ? block.text : '').trim().toLowerCase()
    if (word.startsWith('consistent')) return { verdict: 'consistent' }
    if (word.startsWith('inconsistent')) return { verdict: 'inconsistent' }
    return { verdict: 'unclear' }
  } catch (err) {
    return { verdict: 'unclear', error: err instanceof Error ? err.message : 'vision failed' }
  }
}

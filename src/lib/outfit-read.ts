// WHAT MYRA SAYS ABOUT AN OUTFIT SHE MADE HERSELF.
//
// She has put pieces together and wants to know whether they work. The answer
// is one line. Not a report, not a score out of ten, not a list of everything
// the constitution has an opinion about — one line, the way a stylist standing
// next to her would say it.
//
// THE TONE IS THE HARD PART, and it is deliberate. She chose these pieces. She
// may well be right and MYRA wrong: a rule engine knows the house style, it
// does not know she is wearing this to see someone she has not seen in a year.
// So the default is to back her, the note stays short, and MYRA only reaches
// for an alternative when a rule it holds for EVERY client is broken — the
// clashes that are not a matter of taste.
//
// Under that, anything the house style merely prefers is left alone. Two
// statement pieces is a preference; fuchsia next to a clash is not.
//
// Everything here is pure: no database, no network, no model call. That is why
// the note can appear the moment she adds a piece rather than after a spinner.

import { evaluateHouseStyle, type HouseItem, type RuleHit } from '@/lib/house-style'
import { judgeLook, rulesForMember, type MemberRules } from '@/lib/style-rules'
import { mixesWhiteAndCream } from '@/lib/pale-tone'
import { whyThisSuitsHer, WHY_FALLBACK, type WhyPiece } from '@/lib/look-why'
import type { StylePrefs } from '@/lib/pilot-stylist'

export interface OutfitRead {
  /** 'good' backs her. 'unsure' means a rule every client is held to is broken. */
  tone: 'good' | 'unsure' | 'empty'
  /** The one line she reads. Always present, always a sentence. */
  line: string
  /**
   * What would settle it, when MYRA is unsure. A slot she could change and the
   * reason — the UI uses it to light up the pieces on her own shelves that
   * would fix it, so the suggestion is always something she already has.
   */
  wants?: { slot: string; why: string }
}

/**
 * A rule that is a matter of house taste rather than of things clashing.
 * MYRA holds its own looks to these; it does not correct hers for them.
 *
 * The statement-budget rules are the clearest case. "Exactly one statement
 * element" is how MYRA composes, and Chloe herself calls it more of a
 * preference than a hard rule — telling a client her two favourite pieces
 * cannot be worn together would be the app overruling her taste on a matter of
 * taste. The texture budget and the missing-echo rule are the same kind of
 * thing: real craft, not a clash.
 */
const PREFERENCE_CODES = new Set([
  'statement.multiple',
  'statement.none',
  'texture.budget',
  'echo.none',
  'price.spread',
  'price.tier_skip',
])

/** The slot a broken rule points at, so the fix can be offered from her rail. */
const SLOT_FOR_CODE: Record<string, { slot: string; why: string }> = {
  'silhouette.loose_on_loose': { slot: 'top', why: 'something more fitted' },
  'layer.same_shape': { slot: 'outerwear', why: 'a layer with sleeves' },
  'set.coord_mismatch': { slot: 'bottom', why: 'the other half of the set' },
  'colour.fuchsia': { slot: 'top', why: 'a quieter colour' },
  'colour.discordant': { slot: 'top', why: 'a calmer colour' },
  'colour.rainbow': { slot: 'top', why: 'a quieter colour' },
  'category.activewear': { slot: 'top', why: 'something that is not sportswear' },
  'material.rejected': { slot: 'shoe', why: 'a different material' },
  'material.formality_gap': { slot: 'shoe', why: 'something dressier' },
  'jewellery.loud_on_busy': { slot: 'jewellery', why: 'something finer' },
}

/**
 * How MYRA says a rule is broken. The engine's own messages are written for
 * Chloe — they name rule families and cite the constitution — so they are
 * rewritten here in the second person, for her.
 */
const LINE_FOR_CODE: Record<string, string> = {
  'silhouette.loose_on_loose': 'Both pieces are loose, so the shape gets lost. Something fitted on top would hold it together.',
  'layer.same_shape': 'The layer repeats the shape underneath rather than adding to it.',
  'set.coord_mismatch': 'That is half of a set worn with something else — it reads as a near miss rather than a choice.',
  'colour.fuchsia': 'That pink fights everything next to it.',
  'colour.discordant': 'These colours are pulling against each other.',
  'colour.rainbow': 'There is a lot of colour going on here.',
  'category.activewear': 'Sportswear pulls this out of the outfit it is trying to be.',
  'material.rejected': 'Those two materials do not sit well together.',
  'material.formality_gap': 'One piece is dressed up and one is dressed down, with nothing bridging them.',
  'jewellery.loud_on_busy': 'The jewellery is competing with the outfit rather than finishing it.',
}

/** Warm, short, and never the same sentence twice in a row on her screen. */
const GOOD_LINES = [
  'This works.',
  'Yes — these belong together.',
  'That hangs together nicely.',
  'Good. Nothing fighting.',
]

/**
 * Pick a line that is stable for a given set of pieces: she should not see the
 * wording change when she opens the same outfit again, and a random line would.
 */
function goodLine(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return GOOD_LINES[h % GOOD_LINES.length]
}

export interface ReadInput {
  items: HouseItem[]
  /** Her authored preferences, for the positive half of the note. */
  prefs?: StylePrefs | null
  occasion?: string | null
  /** Her rules, when known. Defaults to the ones every client is held to. */
  rules?: MemberRules
}

export function readOutfit({ items, prefs, occasion, rules }: ReadInput): OutfitRead {
  if (!items.length) {
    return { tone: 'empty', line: 'Add a couple of pieces and I will tell you what I think.' }
  }
  // One piece is not an outfit yet, and saying anything about it would be
  // pretending to an opinion MYRA cannot have.
  if (items.length === 1) {
    return { tone: 'empty', line: 'Add something to go with it.' }
  }

  const held = rules ?? rulesForMember(null, false)
  const judged = judgeLook(items, held, { occasion: occasion ?? null })
  const house = evaluateHouseStyle(items, { occasion: occasion ?? null })

  // White next to cream is judged from the actual hex rather than the colour
  // name, because "ivory" and "cream" are the same problem under two labels.
  // judgeLook deliberately leaves it alone so it is never counted twice.
  const whiteCream = mixesWhiteAndCream(items)

  const blocking: RuleHit[] = judged.violations.filter((v) => !PREFERENCE_CODES.has(v.code))

  if (blocking.length) {
    // One thing, not a list. The first is the most structural, because
    // evaluateHouseStyle reports in that order.
    const first = blocking[0]
    return {
      tone: 'unsure',
      line: LINE_FOR_CODE[first.code] ?? first.message,
      wants: SLOT_FOR_CODE[first.code],
    }
  }

  if (whiteCream) {
    return {
      tone: 'unsure',
      line: 'The white and the cream are close enough to look like a mistake rather than a choice.',
      wants: { slot: 'top', why: 'a cleaner white, or a deeper colour' },
    }
  }

  // Nothing is wrong. Say so briefly, and if her own preferences explain WHY it
  // suits her, use that instead of a bare yes — it is the more useful sentence.
  const why = whyThisSuitsHer(items as unknown as WhyPiece[], prefs ?? null)
  const seed = items.map((i) => i.item_id ?? '').join('|')
  if (why && why !== WHY_FALLBACK) return { tone: 'good', line: why }
  return { tone: 'good', line: goodLine(seed) }
}

/**
 * Which of her own pieces would settle what MYRA is unsure about.
 *
 * The suggestion is always drawn from her wardrobe and the pieces she has
 * saved, never from the catalogue: she asked whether these work, not to be
 * sold something.
 */
export function piecesThatWouldHelp<T extends { slot?: string | null; item_id?: string | null }>(
  read: OutfitRead,
  shelves: T[],
  inOutfit: Set<string>,
): T[] {
  if (read.tone !== 'unsure' || !read.wants) return []
  const { slot } = read.wants
  return shelves.filter((p) => p.slot === slot && !inOutfit.has(String(p.item_id))).slice(0, 8)
}

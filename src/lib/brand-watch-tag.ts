// STYLE TAGS FOR A QUEUED PIECE — the seventeen 1-5 dimensions the library
// already carries, read before she decides rather than after.
//
// WHY THIS EXISTS
// The confidence number on a queue card could only read brand history, colour
// family, price band and the words of the product name. It could not see the
// clothes. Measured walk-forward on 5,553 of her decisions (2026-09-29), that
// scored AUC 0.560 against a 0.500 coin flip, and auto-accepting the top decile
// would have been right 44.8% of the time — worse than the 64.7% she gets by
// accepting at random. A scorer that cannot see a garment cannot judge one.
//
// The accepted half of the evidence was already free: 3,249 of 3,409 accepted
// Brand Watch pieces became tagged library items. The missing half is what she
// TURNS DOWN — a skipped piece never becomes an item, so nothing recorded it.
//
// WHAT IT COSTS, AND WHY SO LITTLE
// Three tiers, cheapest first, each only filling what the one before could not:
//
//   rules   free      the words a feed already states outright
//   text    ~$0.0002  a batched read of name + description
//   vision  ~$0.0015  the photograph, 512px and a compact reply
//
// Two things keep the vision tier honest. It is asked for at 512px rather than
// the 900px default, because Claude charges by image area and a cut, a drape
// and a sheen do not need a big picture — that is about a third of the tokens.
// And every read is cached against the image URL forever, the same contract as
// brand_watch_colour_read, which has already spared 3,232 repeat reads.

import Anthropic from '@anthropic-ai/sdk'
// Relative, not '@/lib/…': this module is loaded by the offline evaluator too,
// which has no bundler to resolve the alias.
import { fetchImageForVision } from './vision-image'

/** The dimensions, in the order the compact reply returns them. */
export const TAG_DIMENSIONS = [
  'fit', 'length', 'rise', 'structure', 'shoulder', 'neckline', 'sleeve',
  'waist_definition', 'leg_opening', 'surface', 'colour_depth', 'pattern',
  'sheen', 'material_weight', 'material_formality', 'jewellery_scale',
  'jewellery_formality',
] as const

export type TagDimension = (typeof TAG_DIMENSIONS)[number]
export type StyleTags = Partial<Record<TagDimension, number>>

/**
 * Who reads the photograph.
 *
 * OpenAI, because it was measured cheaper AND no worse (2026-09-29). On 60 real
 * garments whose library tags are known, gpt-6-luna at detail:'low' with
 * reasoning off agreed with the library exactly as often as the frontier model
 * — 58.1% against 60.3%, a gap well inside the noise on that sample — while
 * costing 23x less per image. Every reading from every candidate landed within
 * one point of the library's tag on a 1-5 scale, so the cheap tier is never
 * wildly wrong; it is at worst one step out, and the disagreement is almost
 * always adjacent.
 *
 * That drops the price of an image from $0.0033 (Claude Haiku) to $0.000078:
 * $1.24 to read all 16,000 queued pieces, against $53 for Haiku. Cheap enough
 * that cost stops being the reason to skip a garment.
 *
 * Anthropic is still wired up and is one env var away, because a provider
 * outage should not mean an untagged catalogue.
 */
export type TagProvider = 'openai' | 'anthropic'
export const TAG_PROVIDER: TagProvider = (process.env.BRAND_WATCH_TAG_PROVIDER as TagProvider) || 'openai'

/**
 * detail:'low' is not a shortcut, it is the measurement. It sends ~390 image
 * tokens instead of ~3,000, and on the 60-piece sample the low-detail reads
 * were no less accurate than the high-detail ones (58.1% vs 58.8% exact).
 * reasoning_effort:'none' likewise: turning reasoning on bought nothing and
 * cost 3-4x.
 */
export const OPENAI_TAG_MODEL = process.env.BRAND_WATCH_OPENAI_MODEL || 'gpt-6-luna'
export const OPENAI_TAG_DETAIL = (process.env.BRAND_WATCH_OPENAI_DETAIL as 'low' | 'high') || 'low'

/** Anthropic's cheap tier, kept as the fallback reader. */
export const TAG_MODEL = 'claude-haiku-4-5-20251001'
/**
 * The same reading done by a bigger model, for the one question worth asking
 * about the cheap one: is it getting the garment right, or is it confidently
 * guessing? Run both over the same sample and compare against the library's own
 * tags — a cheap model that is merely cheap is not cheap.
 */
export const TAG_MODEL_STRONG = 'claude-sonnet-5-5'
/** Claude charges by image area; a cut and a drape read fine this small. */
const TAG_IMAGE_WIDTH = 512

/** Dollars per million tokens, input and output, from each provider's table. */
const PRICES: Record<string, [number, number]> = {
  'gpt-6-luna': [0.1, 0.5],
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5.4-nano': [0.05, 0.4],
  'claude-haiku-4-5-20251001': [1, 5],
  'claude-sonnet-5-5': [2, 10],
}

// ---------------------------------------------------------------- tier 1: rules

/**
 * What the feed already says in plain words. Free, exact, and it runs first so
 * the paid tiers are only ever asked for what is genuinely missing. Modelled on
 * the COLOUR_LEXICON in brand-watch, which reads colourways the same way.
 *
 * Deliberately narrow: a rule only fires on a phrase that can mean one thing.
 * A wrong tag is worse than no tag, because it both scores the piece and files
 * it in the library.
 */
const RULES: Array<[RegExp, StyleTags]> = [
  // fit
  [/\boversized|\bslouchy|\brelaxed fit|\bboxy\b/i, { fit: 5 }],
  [/\bbodycon|\bsecond skin|\bfitted\b|\bslim fit\b/i, { fit: 2 }],
  // length
  [/\bcropped\b|\bcrop top\b/i, { length: 1 }],
  [/\bmaxi\b|\bfloor.length\b|\bankle.length\b/i, { length: 5 }],
  [/\bmidi\b/i, { length: 4 }],
  [/\bmini\b(?!.*\bbag\b)/i, { length: 2 }],
  // rise
  [/\bhigh.(?:rise|waist)/i, { rise: 5 }],
  [/\bmid.(?:rise|waist)/i, { rise: 3 }],
  [/\blow.(?:rise|waist)/i, { rise: 1 }],
  // sleeve
  [/\bsleeveless\b|\bstrappy\b|\bcami\b|\btank\b|\bhalter\b/i, { sleeve: 1 }],
  [/\bshort.sleeve/i, { sleeve: 3 }],
  [/\bthree.quarter|\b3\/4 sleeve/i, { sleeve: 4 }],
  [/\blong.sleeve/i, { sleeve: 5 }],
  // neckline
  [/\bhigh.neck|\bfunnel.neck|\bturtle.?neck|\broll.?neck|\bcrew.?neck/i, { neckline: 1 }],
  [/\bv.?neck\b|\bscoop.?neck/i, { neckline: 3 }],
  [/\bplunge|\bplunging\b/i, { neckline: 5 }],
  // leg opening
  [/\bwide.leg|\bflare\b|\bflared\b|\bbootcut\b|\bpalazzo\b/i, { leg_opening: 5 }],
  [/\bstraight.leg\b/i, { leg_opening: 3 }],
  [/\bskinny\b|\bcigarette\b|\btapered\b|\bslim.leg\b/i, { leg_opening: 1 }],
  // surface / pattern
  [/\bsequin|\bembellish|\bembroider|\bbeaded\b/i, { surface: 5, pattern: 4 }],
  [/\bfloral\b|\bpaisley\b|\bgingham\b|\bhoundstooth\b|\btartan\b|\bplaid\b/i, { pattern: 5, surface: 4 }],
  [/\bstriped?\b|\bcheck(?:ed)?\b|\bpolka\b|\bspotted\b/i, { pattern: 4 }],
  [/\bplain\b|\bsolid\b/i, { pattern: 1 }],
  // sheen
  [/\bsatin\b|\bsilk\b|\bpatent\b|\bmetallic\b|\blam(?:e|é)\b/i, { sheen: 4 }],
  [/\bmatte\b|\bbrushed\b|\bsuede\b/i, { sheen: 1 }],
  // weight / formality
  [/\bsheer\b|\bchiffon\b|\borganza\b|\bvoile\b/i, { material_weight: 1 }],
  [/\bchunky knit|\bcable knit|\bquilted\b|\bpadded\b|\bcanvas\b|\bdenim\b/i, { material_weight: 5 }],
  [/\bgown\b|\bblack tie\b|\boccasion\b|\bbridal\b/i, { material_formality: 5 }],
  [/\bjogger|\bsweatpant|\bhoodie\b|\bjersey\b|\bloungewear\b/i, { material_formality: 1 }],
  // structure / shoulder
  [/\bunstructured\b|\bdrape[d]?\b|\bfluid\b/i, { structure: 5 }],
  [/\btailored\b|\bcorset(?:ed)?\b|\bboned\b/i, { structure: 2 }],
  [/\bpadded shoulder|\bstrong shoulder/i, { shoulder: 1 }],
  [/\boff.(?:the.)?shoulder|\bbardot\b/i, { shoulder: 5 }],
]

/** Free tags from the words a feed already states. Never guesses. */
export function tagFromRules(text: string): StyleTags {
  const out: StyleTags = {}
  for (const [re, tags] of RULES) {
    if (!re.test(text)) continue
    // First rule to speak about a dimension wins — the list runs most specific
    // first, so "long sleeve" is not then overwritten by a looser match.
    for (const [dim, value] of Object.entries(tags)) {
      if (out[dim as TagDimension] == null) out[dim as TagDimension] = value
    }
  }
  return out
}

// ---------------------------------------------------------------- the reply

/**
 * One line, one value per dimension, `x` where it does not apply. About forty
 * tokens back instead of the ~350 the library's JSON prompt returns, which on
 * a catalogue-sized run is most of the bill.
 */
/**
 * The legend itself. Exported so the model comparison and the cost model both
 * send the same one the tagger sends — comparing models on a different prompt
 * measures the prompt, not the models.
 */
export const TAG_FORMAT = `Reply with ONE line: ${TAG_DIMENSIONS.length} values separated by commas, in this exact order:
${TAG_DIMENSIONS.join(',')}

Each value is a whole number 1-5, or x when the dimension does not apply to this kind of piece (rise and leg_opening on a bag, neckline and sleeve on a shoe, the jewellery_ pair on anything that is not jewellery). Never explain, never add units, never use markdown.

What the numbers mean:
fit 1 skin tight → 5 oversized
length 1 cropped → 5 maxi/floor
rise 1 ultra low → 5 ultra high
structure 1 fully boned → 5 unstructured
shoulder 1 heavily padded → 5 off-shoulder/none
neckline 1 high/closed → 3 open v or scoop → 5 plunging
sleeve 1 sleeveless, 2 cap, 3 short, 4 three-quarter, 5 full long
waist_definition 1 corseted → 5 boxy
leg_opening 1 narrow → 5 flared
surface 1 clean/flat → 5 highly worked
colour_depth 1 pure neutral → 5 bold/bright
pattern 1 none → 5 statement pattern
sheen 1 matte → 5 high shine
material_weight 1 sheer → 5 structural
material_formality 1 casual → 5 occasion
jewellery_scale 1 micro → 5 sculptural
jewellery_formality 1 everyday → 5 haute joaillerie`

/** Parse the compact line. Returns null when it does not match the contract. */
export function parseTagLine(reply: string): StyleTags | null {
  const line = reply.trim().split('\n').map((l) => l.trim()).filter(Boolean).pop()
  if (!line) return null
  const parts = line.split(',').map((p) => p.trim().toLowerCase())
  if (parts.length !== TAG_DIMENSIONS.length) return null
  const out: StyleTags = {}
  parts.forEach((p, i) => {
    if (p === 'x' || p === 'null' || p === '') return
    const n = Number(p)
    // Out-of-range is a misread, not a reading. Dropping it leaves the
    // dimension null, which is honest; keeping it would poison the training set.
    if (!Number.isInteger(n) || n < 1 || n > 5) return
    out[TAG_DIMENSIONS[i]] = n
  })
  return Object.keys(out).length ? out : null
}

export interface TagResult {
  tags: StyleTags
  source: 'rules' | 'text' | 'vision'
  usage?: { input_tokens: number; output_tokens: number }
  /** Which model answered. Recorded so a read can be priced and audited later. */
  model?: string
  error?: string
}

/**
 * An API failure is not evidence about a garment. Spent credit, a rate limit
 * or a 503 must never be cached and must never be counted as "this piece could
 * not be read" — brand-watch already learned this the hard way, when an
 * out-of-credit spell read a whole catalogue as having no colour and Bimba y
 * Lola queued nothing. A caller seeing these should stop, not carry on.
 */
export const isTransientError = (error?: string | null): boolean =>
  !!error && /credit|usage limit|rate.?limit|overloaded|timeout|429|5\d\d|ECONN|fetch failed|not configured/i.test(error)

let client: Anthropic | null = null
function anthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  client ??= new Anthropic({ apiKey })
  return client
}

// ---------------------------------------------------------------- tier 2: text

/**
 * The copy a text-tier call actually reads: what kind of thing it is, what it
 * is called, and what the shop says about it. Capped, because the end of a long
 * description is usually care instructions, and because the cap is the only
 * thing standing between a 700-word brand manifesto and the bill.
 */
export const textCopyOf = (piece: {
  productName: string | null; description?: string | null; itemType?: string | null
}): string => [piece.itemType, piece.productName, piece.description].filter(Boolean).join('. ').slice(0, 1500)

/**
 * The exact text a text-tier call sends. Exported so the cost model measures
 * the same prompt the tagger actually sends, rather than a paraphrase of it —
 * a cost estimate built from a different prompt is an estimate of nothing.
 */
export function buildTextPrompt(copy: string): string {
  return `Here is a fashion product's category, name and description:\n\n${copy}\n\n${TAG_FORMAT}\n\nAnswer x for anything the text does not tell you. Do not guess.`
}

/**
 * Read the cut from the shop's own copy. Far cheaper than looking at the
 * photograph, and a description that says "relaxed cashmere high-neck vest"
 * already answers fit, neckline, sleeve and material without an image.
 */
export async function tagFromTextOpenAI(
  piece: { productName: string | null; description?: string | null; itemType?: string | null },
  opts: { model?: string } = {},
): Promise<TagResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { tags: {}, source: 'text', error: 'OPENAI_API_KEY not configured' }
  const model = opts.model ?? OPENAI_TAG_MODEL
  const copy = textCopyOf(piece)
  if (copy.replace(/\s+/g, ' ').length < 40) return { tags: {}, source: 'text', error: 'not enough copy to read' }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_completion_tokens: 300,
        reasoning_effort: 'none',
        messages: [{ role: 'user', content: buildTextPrompt(copy) }],
      }),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) return { tags: {}, source: 'text', error: `HTTP ${res.status}: ${(j?.error?.message ?? '').slice(0, 160)}` }
    const tags = parseTagLine(String(j.choices?.[0]?.message?.content ?? ''))
    return {
      tags: tags ?? {},
      source: 'text',
      model,
      usage: { input_tokens: j.usage?.prompt_tokens ?? 0, output_tokens: j.usage?.completion_tokens ?? 0 },
    }
  } catch (err) {
    return { tags: {}, source: 'text', error: err instanceof Error ? err.message : 'text tagging failed' }
  }
}

export async function tagFromTextAnthropic(
  piece: { productName: string | null; description?: string | null; itemType?: string | null },
  opts: { model?: string } = {},
): Promise<TagResult> {
  const client = anthropic()
  if (!client) return { tags: {}, source: 'text', error: 'ANTHROPIC_API_KEY not configured' }
  const model = opts.model ?? TAG_MODEL
  const copy = textCopyOf(piece)
  if (copy.replace(/\s+/g, ' ').length < 40) return { tags: {}, source: 'text', error: 'not enough copy to read' }
  try {
    const r = await client.messages.create({
      model,
      max_tokens: 120,
      messages: [{ role: 'user', content: buildTextPrompt(copy) }],
    })
    const text = r.content.find((b) => b.type === 'text')
    return {
      tags: (text && text.type === 'text' ? parseTagLine(text.text) : null) ?? {},
      source: 'text',
      model,
      usage: { input_tokens: r.usage?.input_tokens ?? 0, output_tokens: r.usage?.output_tokens ?? 0 },
    }
  } catch (err) {
    return { tags: {}, source: 'text', error: err instanceof Error ? err.message : 'text tagging failed' }
  }
}

export async function tagFromText(
  piece: { productName: string | null; description?: string | null; itemType?: string | null },
  opts: { model?: string; provider?: TagProvider } = {},
): Promise<TagResult> {
  const provider = opts.provider ?? TAG_PROVIDER
  if (provider === 'anthropic') return tagFromTextAnthropic(piece, opts)
  return tagFromTextOpenAI(piece, opts)
}

// ---------------------------------------------------------------- tier 3: vision

/** The instruction both providers get. Kept in one place so neither drifts. */
const VISION_PROMPT = `Judge the single garment or accessory being sold in this product photo. Ignore the background, the model, and anything else styled with it.\n\n${TAG_FORMAT}`

/**
 * Read the piece off a photograph, with the measured-cheapest reader.
 *
 * The image is passed as a URL, not as bytes. Claude needs the bytes; OpenAI
 * accepts the link and fetches it itself, which removes a download, a resize
 * and a base64 round-trip from every single piece — and with detail:'low' the
 * server reduces it to 512px anyway, so the resize was doing nothing. The
 * fallback to downloading is only for a host that refuses OpenAI's fetcher.
 */
export async function tagFromVisionOpenAI(
  imageUrl: string,
  opts: { model?: string; detail?: 'low' | 'high' } = {},
): Promise<TagResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { tags: {}, source: 'vision', error: 'OPENAI_API_KEY not configured' }
  const model = opts.model ?? OPENAI_TAG_MODEL
  const detail = opts.detail ?? OPENAI_TAG_DETAIL

  const call = async (url: string) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_completion_tokens: 300,
        // Off, because it was measured: reasoning cost 3-4x and bought nothing
        // on the 60-piece sample.
        reasoning_effort: 'none',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url, detail } },
          { type: 'text', text: VISION_PROMPT },
        ]}],
      }),
    })
    const j: any = await res.json().catch(() => ({}))
    return { res, j }
  }

  try {
    let { res, j } = await call(imageUrl)
    // A host that blocks the model's own fetcher answers 400/404; retrying with
    // the bytes costs a download but saves the piece.
    if (!res.ok && /image|url|download|fetch/i.test(String(j?.error?.message ?? ''))) {
      const { image } = await fetchImageForVision(imageUrl, TAG_IMAGE_WIDTH)
      if (image) ({ res, j } = await call(`data:${image.mediaType};base64,${image.data}`))
    }
    if (!res.ok) return { tags: {}, source: 'vision', error: `HTTP ${res.status}: ${(j?.error?.message ?? '').slice(0, 160)}` }
    const usage = { input_tokens: j.usage?.prompt_tokens ?? 0, output_tokens: j.usage?.completion_tokens ?? 0 }
    const tags = parseTagLine(String(j.choices?.[0]?.message?.content ?? ''))
    return { tags: tags ?? {}, source: 'vision', usage, model, ...(tags ? {} : { error: 'reply did not match the format' }) }
  } catch (err) {
    return { tags: {}, source: 'vision', error: err instanceof Error ? err.message : 'vision tagging failed' }
  }
}

/** The Claude reader. Kept as the fallback, not the default. */
export async function tagFromVisionAnthropic(
  imageUrl: string,
  opts: { model?: string } = {},
): Promise<TagResult> {
  const client = anthropic()
  if (!client) return { tags: {}, source: 'vision', error: 'ANTHROPIC_API_KEY not configured' }
  const { image, error } = await fetchImageForVision(imageUrl, TAG_IMAGE_WIDTH)
  if (!image) return { tags: {}, source: 'vision', error }
  try {
    const r = await client.messages.create({
      model: opts.model ?? TAG_MODEL,
      max_tokens: 120,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: VISION_PROMPT },
      ]}],
    })
    const text = r.content.find((b) => b.type === 'text')
    const tags = text && text.type === 'text' ? parseTagLine(text.text) : null
    return {
      tags: tags ?? {},
      source: 'vision',
      usage: { input_tokens: r.usage?.input_tokens ?? 0, output_tokens: r.usage?.output_tokens ?? 0 },
      model: opts.model ?? TAG_MODEL,
      ...(tags ? {} : { error: 'reply did not match the format' }),
    }
  } catch (err) {
    return { tags: {}, source: 'vision', error: err instanceof Error ? err.message : 'vision tagging failed' }
  }
}

/**
 * Read the piece off the photograph, with whichever reader is configured.
 * One image per call rather than a batch: batching amortises the prompt, but it
 * also invites the model to attribute one garment's cut to another, and this is
 * training data — a wrong tag here teaches the wrong thing for good.
 */
export async function tagFromVision(imageUrl: string, opts: { model?: string; provider?: TagProvider } = {}): Promise<TagResult> {
  const provider = opts.provider ?? TAG_PROVIDER
  if (provider === 'anthropic') return tagFromVisionAnthropic(imageUrl, opts)
  return tagFromVisionOpenAI(imageUrl, opts)
}

// ---------------------------------------------------------------- the cache

/** Tags already read for these images, whatever they cost the first time. */
export async function loadTagReads(admin: any, urls: string[]): Promise<Map<string, StyleTags>> {
  const out = new Map<string, StyleTags>()
  const unique = Array.from(new Set(urls.filter(Boolean)))
  for (let i = 0; i < unique.length; i += 200) {
    try {
      const { data } = await admin
        .from('brand_watch_tag_read').select('image_url, tags')
        .in('image_url', unique.slice(i, i + 200))
      for (const r of data ?? []) out.set(String(r.image_url), (r.tags ?? {}) as StyleTags)
    } catch { /* an unavailable cache costs money, not correctness */ }
  }
  return out
}

export async function saveTagReads(
  admin: any,
  rows: Array<{ image_url: string; tags: StyleTags; model?: string }>,
): Promise<void> {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += 200) {
    try {
      await admin.from('brand_watch_tag_read')
        .upsert(rows.slice(i, i + 200).map((r) => ({ ...r, model: r.model ?? OPENAI_TAG_MODEL })), { onConflict: 'image_url' })
    } catch { /* same — never fail a run over the cache */ }
  }
}

// ---------------------------------------------------------------- orchestration

/**
 * What a call cost, for the spend counter. Takes the model, because a single
 * price would have reported OpenAI reads at Claude's rate and overstated the
 * bill by a factor of forty.
 */
export const costOf = (
  usage?: { input_tokens: number; output_tokens: number },
  model: string = OPENAI_TAG_MODEL,
): number => {
  if (!usage) return 0
  const [pi, po] = PRICES[model] ?? PRICES[OPENAI_TAG_MODEL]
  return (usage.input_tokens / 1e6) * pi + (usage.output_tokens / 1e6) * po
}

/**
 * Dimensions worth paying to learn for this kind of piece. */
const NEVER_APPLIES: Record<string, TagDimension[]> = {
  bag: ['rise', 'leg_opening', 'neckline', 'sleeve', 'shoulder', 'waist_definition', 'length'],
  shoe: ['rise', 'leg_opening', 'neckline', 'sleeve', 'shoulder', 'waist_definition'],
}
const KIND_OF: Record<string, keyof typeof NEVER_APPLIES> = {
  tote: 'bag', clutch: 'bag', crossbody: 'bag', shoulder_bag: 'bag', structured_bag: 'bag',
  boot: 'shoe', heel: 'shoe', flat: 'shoe', sneaker: 'shoe', mule: 'shoe', sandal: 'shoe',
}

/**
 * Tag one piece as cheaply as it can be tagged: free rules first, then the
 * shop's copy, and the photograph only if those two left the piece too thin to
 * judge. `minDimensions` is what "thin" means — below it the piece cannot be
 * placed in style space, so the image is worth buying.
 */
export async function tagPiece(
  piece: {
    productName: string | null
    description?: string | null
    itemType?: string | null
    imageUrl?: string | null
  },
  opts: { minDimensions?: number; allowText?: boolean; allowVision?: boolean; cached?: StyleTags } = {},
): Promise<TagResult & { cost: number; transient?: boolean }> {
  const { minDimensions = 8, allowText = true, allowVision = true } = opts
  const enough = (t: StyleTags) => Object.keys(t).length >= minDimensions

  if (opts.cached && enough(opts.cached)) return { tags: opts.cached, source: 'vision', cost: 0 }

  const tags: StyleTags = { ...tagFromRules([piece.itemType, piece.productName, piece.description].filter(Boolean).join(' ')) }
  if (enough(tags)) return { tags, source: 'rules', cost: 0 }

  let cost = 0
  if (allowText && piece.description) {
    const r = await tagFromText(piece)
    cost += costOf(r.usage, r.model)
    // Rules win where they spoke: they read words, not impressions.
    for (const [k, v] of Object.entries(r.tags)) if (tags[k as TagDimension] == null) tags[k as TagDimension] = v
    if (enough(tags)) return { tags, source: 'text', cost }
  }

  if (allowVision && piece.imageUrl) {
    const r = await tagFromVision(piece.imageUrl)
    cost += costOf(r.usage, r.model)
    for (const [k, v] of Object.entries(r.tags)) if (tags[k as TagDimension] == null) tags[k as TagDimension] = v
    return { tags, source: 'vision', cost, error: r.error, transient: isTransientError(r.error) }
  }

  return { tags, source: 'rules', cost }
}

/** Dimensions that were never going to apply, so a thin read is not a failed one. */
export const applicableDimensions = (itemType: string | null | undefined): TagDimension[] => {
  const kind = itemType ? KIND_OF[itemType] : undefined
  const never = new Set<TagDimension>([
    ...(kind ? NEVER_APPLIES[kind] : []),
    ...(itemType && !/earring|necklace|bracelet|ring|brooch/.test(itemType)
      ? (['jewellery_scale', 'jewellery_formality'] as TagDimension[])
      : []),
  ])
  return TAG_DIMENSIONS.filter((d) => !never.has(d))
}

// ------------------------------------------------- the look, in words

/**
 * THE BETTER REPRESENTATION, though not a solution to the new-brand problem.
 *
 * The seventeen dimensions above describe how a garment is MADE — rise,
 * shoulder, leg opening. Asking instead how a piece LOOKS, and comparing the
 * descriptions as embeddings, beat both those dimensions and the existing
 * confidence model on all four chronological splits tested, on 3,139 decisions
 * across 32 brands: 0.619 overall against 0.537 and 0.561.
 *
 * It is NOT evidence that a new brand can be judged from its clothes alone:
 * within a single brand the advantage disappears (0.643 against 0.651). That
 * caveat, and the modest ceiling in absolute terms, is set out in full in
 * brand-watch-style-fit.ts next to the scorer itself.
 *
 * Material, care and brand are named as forbidden because a description
 * mentioning "Mos Mosh" would let a similarity search recognise the label, and
 * the whole point is to judge the item. Composition is left out for the same
 * reason: it is a proxy for price and provenance, not a look.
 *
 * "ONLY the single garment" and "ignore anything styled with it" are load
 * bearing and were added after inspection. Without them the model described the
 * whole outfit — a knitwear pullover came back as "high-waisted wide-leg
 * trousers" and a pair of shorts as "white tee and lace-trim shorts". A phrase
 * about the styling rather than the garment is a channel for brand recognition,
 * because a shop photographs its pieces in a consistent house style. Measured
 * on 396 pieces against the old wording, the fixed prompt scored 0.659 against
 * 0.578.
 */
export const PHRASE_PROMPT = `Describe ONLY the single garment or accessory being sold in this product photo.

Reply with a short phrase of 8 to 16 words covering its aesthetic, mood and silhouette — for example: "minimal oversized wool coat, quiet luxury, sharp menswear edge" or "romantic floral tea dress, soft feminine, vintage-inspired".

Ignore the model, the background, and anything else styled with it. Do not describe the outfit, the other garments, or how it is being worn. Do not mention material composition, care, sizing, price, or any brand name.
Reply with the phrase only, no explanation.`

/**
 * The earlier wording, kept so the two can be measured against each other
 * rather than assumed apart. Without "ONLY the single garment" and an explicit
 * instruction to ignore what it is styled with, the model described the whole
 * outfit — a knitwear pullover came back as "high-waisted wide-leg trousers"
 * and a pair of shorts as "white tee and lace-trim shorts".
 *
 * That failure is worse than noise: a phrase about the styling rather than the
 * garment lets similarity search recognise a shop's look. Brands photograph
 * their pieces in a consistent house style, so two garments from one label
 * resemble each other whether or not they resemble each other as clothes. That
 * would score well overall and collapse inside a single brand — which is
 * exactly the pattern the first measurements showed, and a reason to distrust
 * them until this prompt is re-measured.
 */
export const PHRASE_PROMPT_V1 = `Describe this garment's STYLE as a short phrase of 8 to 16 words.

Cover the aesthetic, the mood, and the silhouette — for example: "minimal oversized wool coat, quiet luxury, sharp menswear edge" or "romantic floral tea dress, soft feminine, vintage-inspired".

Describe how it LOOKS. Do not mention materials composition, care, sizing, price, the model, the background, or any brand name.
Reply with the phrase only, no punctuation at the start, no explanation.`

/** The embedding model, small and cheap enough to run over a whole catalogue. */
export const EMBED_MODEL = 'text-embedding-3-small'

export interface StylePhraseResult {
  phrase: string
  usage?: { input_tokens: number; output_tokens: number }
  model?: string
  error?: string
}

/** Describe the look of one piece. One image per call; ~$0.00008 each. */
export async function describeStyle(
  imageUrl: string,
  opts: { model?: string; prompt?: string } = {},
): Promise<StylePhraseResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { phrase: '', error: 'OPENAI_API_KEY not configured' }
  const model = opts.model ?? OPENAI_TAG_MODEL
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_completion_tokens: 200,
        reasoning_effort: 'none',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: imageUrl, detail: OPENAI_TAG_DETAIL } },
          { type: 'text', text: opts.prompt ?? PHRASE_PROMPT },
        ]}],
      }),
    })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) return { phrase: '', error: `HTTP ${res.status}: ${(j?.error?.message ?? '').slice(0, 160)}` }
    const phrase = String(j.choices?.[0]?.message?.content ?? '').trim().replace(/\s+/g, ' ')
    return {
      phrase,
      model,
      usage: { input_tokens: j.usage?.prompt_tokens ?? 0, output_tokens: j.usage?.completion_tokens ?? 0 },
      ...(phrase ? {} : { error: 'empty phrase' }),
    }
  } catch (err) {
    return { phrase: '', error: err instanceof Error ? err.message : 'describe failed' }
  }
}

/** Dollars per million tokens for the embedding model. */
const EMBED_PRICE_PER_M = 0.02

/**
 * Turn phrases into vectors, batched. Descriptions are stored, not recomputed,
 * so this runs once per phrase and never again.
 */
export async function embedPhrases(
  phrases: string[],
  opts: { model?: string } = {},
): Promise<{ vectors: number[][]; cost: number; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { vectors: [], cost: 0, error: 'OPENAI_API_KEY not configured' }
  const model = opts.model ?? EMBED_MODEL
  const vectors: number[][] = []
  let tokens = 0
  try {
    for (let i = 0; i < phrases.length; i += 256) {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: phrases.slice(i, i + 256) }),
      })
      const j: any = await res.json().catch(() => ({}))
      if (!res.ok) return { vectors, cost: (tokens / 1e6) * EMBED_PRICE_PER_M, error: `HTTP ${res.status}: ${(j?.error?.message ?? '').slice(0, 160)}` }
      for (const e of j.data ?? []) vectors.push(e.embedding)
      tokens += j.usage?.total_tokens ?? 0
    }
    return { vectors, cost: (tokens / 1e6) * EMBED_PRICE_PER_M }
  } catch (err) {
    return { vectors, cost: (tokens / 1e6) * EMBED_PRICE_PER_M, error: err instanceof Error ? err.message : 'embed failed' }
  }
}

/**
 * Read one piece's look and make it comparable: describe, then embed.
 * Cached by the caller against the image URL, so it is never paid for twice.
 */
export async function styleVectorFor(
  imageUrl: string,
): Promise<{ phrase: string; embedding: number[]; cost: number; error?: string }> {
  const described = await describeStyle(imageUrl)
  if (!described.phrase) return { phrase: '', embedding: [], cost: 0, error: described.error ?? 'no phrase' }
  const embedded = await embedPhrases([described.phrase])
  const vec = embedded.vectors[0]
  if (!vec) return { phrase: described.phrase, embedding: [], cost: embedded.cost, error: embedded.error ?? 'no embedding' }
  return {
    phrase: described.phrase,
    embedding: vec,
    cost: costOf(described.usage, described.model) + embedded.cost,
  }
}

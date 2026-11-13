// A LOOK, PIECE BY PIECE — every key piece of the picture matched on its own.
//
// The first version of look projects (lib/review-inspiration) chose anchors
// for the picture's lead piece and left the rest to the sentence composer,
// which reads product NAMES. Chloe, 2026-11-12, on a cropped grey jacket over
// a sheer beaded skirt with fluorescent heels: "it needs to anchor each item…
// mesh skirt, a preppy buttoned jacket, cool heels — pull out the key pieces
// that make up this style of outfit, and then find similar items". One look
// had come back around a full paisley organza circle skirt: organza by name,
// nothing like the skirt in the picture.
//
// So, for every piece the eye read in the picture:
//   1. SHORTLIST from the library by what can be read without looking: its
//      type, its cloth, the words of its character and what the shops call
//      them (signatureScore), its colour when the colour is the point. The
//      best few of every price point, so an anchor at any price finds partners.
//   2. THE EYE scores each of those 0–10 against the picture itself — the
//      product photo beside the runway photo: same silhouette and volume,
//      same fabric feel, same length and decoration. Only what looks like the
//      piece is kept.
// Looks are then composed ONLY from those matches (a slot the picture does not
// show — a top under a jacket — is filled quietly), around anchors taken in
// turn from the look's two key garments.
//
// PRICE POINT is a hard rule here, as in the Review recipe. The same day:
// "someone who buys a £1,700 skirt won't be wearing Fbrq", "a £40 jumper with
// the Erdem skirt — a big no no", "try a less expensive jumper, max like 500"
// (for a £230 skirt). Brand price_tier cannot hold that (it is 3 for 358 of
// 400 brands) and many brands have no authored bracket, so the pieces' own
// prices do: put on one scale (a coat costs about twice a knit, a bag half as
// much again), no piece may cost more than PRICE_SPREAD times another — and
// authored brand brackets still may not sit more than one apart.

import 'server-only'
import { getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import { sellable } from '@/lib/stock-sellable'
import { pairCompat, slotForItemType, type Slot } from '@/lib/composer'
import { COLOUR, MATERIAL, hasMaterial } from '@/lib/search-taxonomy'
import { pricePoint as pricePointOf, pricePointViolation as pricePointViolationOf } from '@/lib/price-point'
import { evaluateHouseStyle, statementKind, type HouseVerdict } from '@/lib/house-style'
import { toHouseItem } from '@/lib/house-item'
import { hardSkipPairs } from '@/lib/pipeline'
import { fetchImageForVision } from '@/lib/vision-image'
import { VISION_WORD_MODEL } from '@/lib/openai-vision'
import { loadAskContext } from '@/app/admin/composer/ask-actions'
import { reviewCandidatesFromPicks, anchorPayload, type ReviewCandidate } from '@/app/admin/outfit-review/actions'
import {
  signatureScore, pieceItemTypes, pieceLabel, WAY_CLOSE,
  type InspirationPiece, type PieceMatch, type ProjectInspiration,
} from '@/lib/review-inspiration'

const ONE_PIECE = /\b(jumpsuit|playsuit|boilersuit|catsuit|romper|all[- ]in[- ]one|dungarees?|unitard)\b/i
const NEUTRALS = new Set(['black', 'white', 'cream', 'grey', 'navy', 'brown', 'camel', 'beige', 'taupe', 'ivory'])
const GARMENTS = new Set<Slot>(['outerwear', 'top', 'bottom', 'dress'])

// ── Price point (lib/price-point) ──────────────────────────────────────────

type Worn = { item: ItemWithBrand; slot: Slot }
const pricePointViolation = (worn: Worn[]) => pricePointViolationOf(worn.map((w) => ({ ...(w.item as any), slot: w.slot })))

/** 1 HIGH STREET · 2 CONTEMPORARY · 3 DESIGNER · 4 LUXURY, read off the piece's own price. */
function priceBand(item: ItemWithBrand, slot: Slot): number {
  const p = pricePointOf({ ...(item as any), slot })
  return p == null ? 0 : p < 120 ? 1 : p < 330 ? 2 : p < 800 ? 3 : 4
}

// ── 1. The shortlist ───────────────────────────────────────────────────────

/** The colour family a colour word belongs to ("mustard" → yellow). */
export const colourFamilyOf = (colour: string | null | undefined) => familyOf(colour)

function familyOf(colour: string | null | undefined) {
  const c = (colour ?? '').trim().toLowerCase()
  return c ? String(COLOUR[c] ?? c).toLowerCase() : ''
}

/** How well a product answers a piece of the picture, from its words alone. */
function wordScore(item: ItemWithBrand, piece: InspirationPiece, colourIsThePoint: boolean): number {
  let s = signatureScore(item.product_name, piece)
  if (piece.cloth && hasMaterial(item as any, MATERIAL[piece.cloth] ?? piece.cloth)) s += 1.5
  const want = familyOf(piece.colour)
  const has = String((item as any).colour_family ?? '').toLowerCase()
  // A bag or a shoe is chosen for its colour far more than a garment is.
  if (want && has === want) s += piece.slot === 'bag' || piece.slot === 'shoe' ? 1.5 : 0.75
  // The bright shoe of a neutral look stays bright, whatever the brightness.
  if (colourIsThePoint) s += has && !NEUTRALS.has(has) ? 1 : -2
  return s
}

const PER_BAND = 10
const MAX_FOR_THE_EYE = 40
/** The eye's 0–10: 6 is "clearly the same idea". Below this a piece is not the piece. */
const KEEP_FROM = 6
const KEEP = 14

// ── 2. The eye ─────────────────────────────────────────────────────────────

const EYE_BATCH = 10

function eyePrompt(label: string, n: number, colourIsThePoint: boolean): string {
  return `The first picture is an outfit I want to recreate in spirit. Look only at this piece of it: "${label}".${colourIsThePoint ? `

The COLOUR is the point of this piece: it is the one vivid accent in an otherwise quiet outfit. A product in any vivid, saturated colour can stand in for it; a dark, muted or neutral one (black, brown, burgundy, navy, beige, grey, white) cannot — score those 4 at most.` : ''}

The ${n} pictures after it are products, numbered in order. Score each product from 0 to 10 for how well it could stand in for that piece in an outfit of the same style. What matters, in order: it is the same kind of garment; the same silhouette and volume (a slim sheer skirt is not a full circle skirt, a cropped boxy jacket is not a long blazer); the same fabric feel (sheerness, texture, shine, weight); the same length; the same kind of decoration. Colour need not match, unless the colour is the point of the piece (a bright shoe in a neutral outfit should stay bright).

8–10: near twin. 6–7: clearly the same idea. 4–5: the same garment type with a different feel. 0–3: wrong for this look.

Reply with JSON only: {"scores":[{"n":1,"score":7}, …]} — one entry per product.`
}

/** The eye's score for each product against one piece of the picture; products it could not see are left out. */
async function eyeScores(look: { data: string; mediaType: string }, label: string, items: ItemWithBrand[], colourIsThePoint = false): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || items.length === 0) return out
  const batches: ItemWithBrand[][] = []
  for (let i = 0; i < items.length; i += EYE_BATCH) batches.push(items.slice(i, i + EYE_BATCH))
  await Promise.all(batches.map(async (batch) => {
    const seen: { item: ItemWithBrand; image: { data: string; mediaType: string } }[] = []
    await Promise.all(batch.map(async (item) => {
      const { image } = await fetchImageForVision(String(item.image_url), 520)
      if (image) seen.push({ item, image })
    }))
    if (seen.length === 0) return
    const content: any[] = [
      { type: 'text', text: eyePrompt(label, seen.length, colourIsThePoint) },
      { type: 'image_url', image_url: { url: `data:${look.mediaType};base64,${look.data}`, detail: 'high' } },
    ]
    seen.forEach((s, i) => {
      content.push({ type: 'text', text: `Product ${i + 1}` })
      content.push({ type: 'image_url', image_url: { url: `data:${s.image.mediaType};base64,${s.image.data}`, detail: 'low' } })
    })
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: VISION_WORD_MODEL, max_completion_tokens: 400, reasoning_effort: 'none', messages: [{ role: 'user', content }] }),
        signal: AbortSignal.timeout(90_000),
      })
      const j: any = await res.json().catch(() => ({}))
      if (!res.ok) { console.error('[review-inspiration-match] eye', res.status, String(j?.error?.message ?? '').slice(0, 160)); return }
      const raw = String(j.choices?.[0]?.message?.content ?? '')
      const first = raw.indexOf('{'); const last = raw.lastIndexOf('}')
      if (first === -1 || last <= first) return
      const parsed = JSON.parse(raw.slice(first, last + 1))
      for (const row of (Array.isArray(parsed.scores) ? parsed.scores : []) as any[]) {
        const s = seen[Number(row?.n) - 1]
        const score = Number(row?.score)
        if (s && Number.isFinite(score)) out.set(s.item.item_id, Math.max(0, Math.min(10, score)))
      }
    } catch (err) {
      console.error('[review-inspiration-match] eye', err)
    }
  }))
  return out
}

/** Every key piece of the picture, matched to the library: shortlist by words, then the eye. */
export async function matchInspiration(
  insp: ProjectInspiration,
  /** `pool`: the pieces to match from — a member's library in her size and budget — instead of the whole shop. */
  opts: { pool?: ItemWithBrand[] } = {},
): Promise<{ matches: PieceMatch[]; notes: string[] }> {
  const library = opts.pool ?? await getReadyAndLiveItems({ allowStale: true })
  const pool = library.filter((i) => i.image_url && sellable(i as any))
  const notes: string[] = []
  if (pool.length === 0) return { matches: [], notes: ['The library didn’t load — the database is busy. Try again in a moment'] }
  const { image: look } = await fetchImageForVision(insp.image_url, 1100)
  if (!look) notes.push('MYRA could not open the picture again, so pieces were matched by their words alone')
  // The piece whose colour is the point: the one bright piece of a neutral look.
  const pop = insp.palette === 'pop' ? insp.pieces.find((p) => { const f = familyOf(p.colour); return !!f && !NEUTRALS.has(f) }) : undefined

  const matches = await Promise.all(insp.pieces.map(async (piece): Promise<PieceMatch | null> => {
    const types = new Set(pieceItemTypes(piece))
    const slot = piece.slot
    if (!slot || types.size === 0) return null
    // The shops and the eye do not draw the same lines: a cropped wool "coat"
    // on a runway is sold as a jacket, a bag carried in the hand as a tote.
    // The eye decides between them, so every type of the slot is offered.
    if (slot === 'outerwear') for (const t of ['coat', 'jacket', 'blazer']) types.add(t)
    if (slot === 'bag') for (const t of ['tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag']) types.add(t)
    const ranked = pool
      .filter((i) => types.has(String(i.item_type)) && !((slot === 'top' || slot === 'bottom') && ONE_PIECE.test(i.product_name ?? '')))
      .map((item) => ({ item, words: wordScore(item, piece, piece === pop) }))
      .sort((a, b) => b.words - a.words || String((b.item as any).created_at ?? '').localeCompare(String((a.item as any).created_at ?? '')))
    // The best overall, then the best of every price point.
    const chosen = new Map<string, (typeof ranked)[number]>()
    for (const r of ranked.slice(0, 10)) chosen.set(r.item.item_id, r)
    const perBand = new Map<number, number>()
    for (const r of ranked) {
      if (chosen.size >= MAX_FOR_THE_EYE) break
      const band = priceBand(r.item, slot)
      const n = perBand.get(band) ?? 0
      if (n >= PER_BAND || chosen.has(r.item.item_id)) continue
      perBand.set(band, n + 1)
      chosen.set(r.item.item_id, r)
    }
    const candidates = Array.from(chosen.values())
    const label = pieceLabel(piece)
    const eye = look ? await eyeScores(look, label, candidates.map((c) => c.item), piece === pop) : new Map<string, number>()
    const blind = eye.size === 0
    const scored = candidates
      .map((c) => ({ id: c.item.item_id, score: blind ? Math.min(10, 4 + c.words * 1.2) : (eye.get(c.item.item_id) ?? 0) + Math.min(4, Math.max(0, c.words)) * 0.2 }))
      .sort((a, b) => b.score - a.score)
    let picks = scored.filter((p) => p.score >= KEEP_FROM)
    // A piece the library has nothing really like: its three nearest, so a look can still be finished.
    if (picks.length < 3) picks = scored.slice(0, 3)
    notes.push(`${label} → ${picks.length} of ${candidates.length} look like it${blind ? ' (by words; the eye was unavailable)' : ''}`)
    return { slot, label, hero: piece.hero, picks: picks.slice(0, KEEP).map((p) => ({ id: p.id, score: Number(p.score.toFixed(2)) })) }
  }))
  return { matches: matches.filter((m): m is PieceMatch => !!m && m.picks.length > 0), notes }
}

// ── 3. The looks ───────────────────────────────────────────────────────────

const OPTIONS_PER_PIECE = 5
const FILLERS = 3
const MAX_COMBOS = 4000

function clashes(a: Slot, b: Slot): boolean {
  if (a === 'jewellery' || a === 'accessory' || b === 'jewellery' || b === 'accessory') return false
  if (a === b) return true
  const pair = new Set([a, b])
  return pair.has('dress') && (pair.has('top') || pair.has('bottom'))
}

function missingSlots(present: Slot[]): Slot[] {
  const have = new Set(present)
  const need: Slot[] = have.has('dress') ? ['shoe'] : ['top', 'bottom', 'shoe']
  return need.filter((s) => !have.has(s))
}

/**
 * The looks around one anchor: every other piece of the picture from its own
 * matches, at the anchor's price point. `way` CLOSEST leans to the picture's
 * colours; a tonal picture keeps its other looks tonal in the anchor's colour.
 */
export async function composeInspirationLooks(
  insp: ProjectInspiration,
  anchorId: string,
  way: string | null,
  avoid: string[],
  count: number,
  opts: { pool?: ItemWithBrand[] } = {},
): Promise<{ anchor: ReturnType<typeof anchorPayload>; candidates: ReviewCandidate[] } | null> {
  const matches = insp.matches ?? []
  const library = opts.pool ?? await getReadyAndLiveItems({ allowStale: true })
  const byId = new Map(library.map((i) => [i.item_id, i]))
  const anchor = byId.get(anchorId)
  if (!anchor || !sellable(anchor as any)) return null
  const aSlot = slotForItemType(anchor.item_type)
  const [model, constraints, approvedVectors, config, learnedPairs] = await loadAskContext()
  const avoidCount = new Map<string, number>()
  for (const id of avoid) avoidCount.set(id, (avoidCount.get(id) ?? 0) + 1)
  const pictureColour = new Map(insp.pieces.filter((p) => p.slot).map((p) => [p.slot as Slot, familyOf(p.colour)]))
  const colourOf = (it: ItemWithBrand) => String((it as any).colour_family ?? '').toLowerCase()

  type Option = { item: ItemWithBrand; slot: Slot; like: number; filler: boolean }
  const lists: Option[][] = []
  for (const m of matches) {
    if (m.slot === aSlot || clashes(aSlot, m.slot)) continue
    const options = m.picks
      .map((p) => ({ item: byId.get(p.id), like: p.score }))
      .filter((o): o is { item: ItemWithBrand; like: number } => !!o.item && o.item.item_id !== anchor.item_id && sellable(o.item as any))
      .filter((o) => !pricePointViolation([{ item: anchor, slot: aSlot }, { item: o.item, slot: m.slot }]))
      // Among equals, the piece the project has not worn yet.
      .sort((a, b) => (b.like - (avoidCount.get(b.item.item_id) ?? 0) * 0.6) - (a.like - (avoidCount.get(a.item.item_id) ?? 0) * 0.6))
      .slice(0, OPTIONS_PER_PIECE)
      .map((o) => ({ item: o.item, slot: m.slot, like: o.like, filler: false }))
    if (options.length) lists.push(options)
  }
  // What the picture does not show but a look needs (a top under the jacket): quiet, and at the same price point.
  const pool = library.filter((i) => i.image_url && sellable(i as any))
  for (const slot of missingSlots([aSlot, ...lists.map((l) => l[0].slot)])) {
    const options = pool
      .filter((i) => i.item_id !== anchor.item_id && slotForItemType(i.item_type) === slot && !ONE_PIECE.test(i.product_name ?? ''))
      .filter((i) => statementKind(toHouseItem(i, slot)) == null)
      .filter((i) => !pricePointViolation([{ item: anchor, slot: aSlot }, { item: i, slot }]))
      .map((item) => ({ item, s: pairCompat(anchor, item).total - (avoidCount.get(item.item_id) ?? 0) * 0.05 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, FILLERS)
      .map(({ item }) => ({ item, slot, like: 0, filler: true }))
    if (options.length) lists.push(options)
  }
  if (lists.length === 0) return null

  const tonal = insp.palette === 'tonal' && way !== WAY_CLOSE
  const combos: { picks: Option[]; score: number }[] = []
  const walk = (i: number, acc: Option[]) => {
    if (combos.length >= MAX_COMBOS) return
    if (i === lists.length) {
      if (new Set(acc.map((x) => x.item.item_id)).size !== acc.length) return
      const worn: Worn[] = [{ item: anchor, slot: aSlot }, ...acc.map((x) => ({ item: x.item, slot: x.slot }))]
      if (pricePointViolation(worn)) return
      let sum = 0, weight = 0
      for (const p of acc) { sum += pairCompat(anchor, p.item).total * 2; weight += 2 }
      for (let x = 0; x < acc.length; x++) for (let y = x + 1; y < acc.length; y++) { sum += pairCompat(acc[x].item, acc[y].item).total; weight += 1 }
      const coherence = weight ? sum / weight : 0
      const matched = acc.filter((p) => !p.filler)
      const likeness = matched.length ? matched.reduce((s, p) => s + p.like, 0) / matched.length / 10 : 0
      let colour = 0
      if (way === WAY_CLOSE) {
        const judged = worn.filter((w) => pictureColour.get(w.slot))
        colour = judged.length ? judged.filter((w) => colourOf(w.item) === pictureColour.get(w.slot)).length / judged.length : 0
      } else if (tonal) {
        const clothes = worn.filter((w) => GARMENTS.has(w.slot))
        colour = clothes.length ? clothes.filter((w) => colourOf(w.item) === colourOf(anchor)).length / clothes.length : 0
      }
      const repeats = acc.reduce((s, p) => s + (avoidCount.get(p.item.item_id) ?? 0) * 0.04, 0)
      combos.push({ picks: acc, score: 0.5 * likeness + 0.4 * coherence + 0.15 * colour - repeats })
      return
    }
    for (const o of lists[i]) walk(i + 1, [...acc, o])
  }
  walk(0, [])
  if (combos.length === 0) return null

  const houseOpts = { learnedApprovedPairs: learnedPairs.approved, learnedRejectedPairs: learnedPairs.rejected, softSkipPairs: hardSkipPairs(model) }
  const judged = combos
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map((c) => ({ ...c, verdict: evaluateHouseStyle([toHouseItem(anchor, aSlot), ...c.picks.map((p) => toHouseItem(p.item, p.slot))], houseOpts) as HouseVerdict }))
    // The constitution's own price rules are hard here too; its other rules are named on the card.
    .filter((c) => !c.verdict.violations.some((v) => v.code.startsWith('price.')))
    .sort((a, b) => Number(b.verdict.pass) - Number(a.verdict.pass) || b.score - a.score)

  const chosen: typeof judged = []
  for (const maxShared of [1, 2, 99]) {
    for (const c of judged) {
      if (chosen.length >= count) break
      if (chosen.includes(c)) continue
      const ids = new Set(c.picks.map((p) => p.item.item_id))
      if (chosen.some((o) => o.picks.filter((p) => ids.has(p.item.item_id)).length > Math.min(maxShared, c.picks.length - 1))) continue
      chosen.push(c)
    }
    if (chosen.length >= count) break
  }
  if (chosen.length === 0) return null

  const candidates = reviewCandidatesFromPicks(
    anchor,
    chosen.map((c) => ({ items: c.picks.map((p) => ({ item: p.item, slot: p.slot })), score: Math.max(0, Math.min(1, c.score)), verdict: c.verdict })),
    { styleModel: model, constraints, approvedVectors, config },
  )
  candidates.forEach((cand, i) => {
    const c = chosen[i]
    const added = c.picks.filter((p) => p.filler).map((p) => (p.slot === 'shoe' ? 'shoes' : p.slot))
    cand.reasons = [
      ...(added.length ? [`MYRA added the ${added.join(' and ')} to finish the look — the picture shows none`] : []),
      ...c.verdict.violations.map((v) => `House rule — ${v.message}`),
      ...cand.reasons,
    ]
  })
  return { anchor: anchorPayload(anchor), candidates }
}

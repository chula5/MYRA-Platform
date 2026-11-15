// A LOOK INTO OUTFIT REVIEW — outfits in the style of a picture.
//
// Chloe drops a picture of a whole outfit on Outfit Review: a runway exit, a
// street-style shot, a saved post. This is not the screenshot of ONE piece
// (lib/review-screenshot) — nothing here is hunted in the shops or added to
// the library. The eye reads the LOOK: the pieces that make it (one per part
// of the body, the piece it is built around first), each one's cloth, colour,
// length and the two or three words that give it its character, and whether
// the colours are tonal, neutral, contrasted or a neutral base with one pop.
//
// From that read come two asks in the composer's own vocabulary:
//   CLOSEST TO THE PICTURE   the pieces with their colours
//   IN THIS STYLE            the same pieces, cloths and proportions with no
//                            colour named, so the library answers in its own
// and a project works through both (lib/review-projects): a couple of anchors
// for the closest, the rest spread across colours for the style. A tonal
// picture stays tonal — each style anchor's other garments are asked for in
// the anchor's colour.

import 'server-only'
import { uploadImageBytesToCloudinary } from '@/lib/cloudinary-persist'
import { cloudinaryConfigured } from '@/lib/cloudinary-config'
import { readWordFromImage } from '@/lib/openai-vision'
import { parseOutfitAsk, slotOfPiece } from '@/lib/outfit-ask'
import { slotForItemType, type Slot } from '@/lib/composer'
import { COLOUR, TYPE } from '@/lib/search-taxonomy'

export const WAY_CLOSE = 'CLOSEST TO THE PICTURE'
export const WAY_STYLE = 'IN THIS STYLE'

export type InspirationPalette = 'tonal' | 'neutral' | 'contrast' | 'pop'

export interface InspirationPiece {
  /** A garment word the composer's sentence reader knows: skirt, jumper, heels… */
  type: string
  length: string | null
  colour: string | null
  cloth: string | null
  /** Up to three plain words of character: pencil, cropped, embellished. */
  detail: string[]
  hero: boolean
  slot: Slot | null
}

/**
 * One piece of the picture, matched: the library's pieces that could stand in
 * for it, best first, each scored 0–10 by the eye against the picture itself.
 */
export interface PieceMatch {
  slot: Slot
  label: string
  hero: boolean
  picks: { id: string; score: number }[]
}

/** What a project keeps of the picture it is built around. */
export interface ProjectInspiration {
  /** Every key piece matched on its own (lib/review-inspiration-match), once the project has been planned. */
  matches?: PieceMatch[]
  image_url: string
  title: string
  summary: string
  palette: InspirationPalette | null
  pieces: InspirationPiece[]
  close_ask: string
  style_ask: string
}

export interface InspirationIntake {
  inspiration?: ProjectInspiration
  /** The eye's own line, for an error the page can show. */
  read?: string | null
  message?: string
  error?: string
}

const TYPE_LIST = 'skirt, trousers, jeans, shorts, dress, shirt, blouse, tee, jumper, cardigan, top, corset, bodysuit, coat, trench, jacket, blazer, gilet, cape, heels, flats, boots, sandals, mules, trainers, bag, tote, clutch, crossbody, belt, scarf, necklace, earrings, brooch, hat, sunglasses'
const COLOUR_LIST = 'white, ivory, cream, beige, black, grey, charcoal, navy, blue, baby blue, teal, brown, chocolate, camel, tan, taupe, green, olive, sage, khaki, emerald, mint, burgundy, red, pink, blush, yellow, mustard, orange, rust, coral, purple, lilac, plum, multicolour'
const CLOTH_LIST = 'leather, suede, wool, cashmere, silk, satin, velvet, sequin, lace, denim, linen, cotton, tweed, mesh, organza, chiffon, jersey, fur, shearling, crochet'

export const LOOK_PROMPT = `This is a picture of an outfit being worn — a runway look, a street-style photograph or a saved post. Read the OUTFIT, never the person wearing it.

List the pieces that make the look, at most six, the piece the look is built around FIRST. One piece per part of the body: one outer layer (coat, jacket, blazer) if worn, one top (if a jumper or cardigan is worn over a shirt, list the jumper or cardigan and name the collar in its detail), one bottom or a dress, the shoes, the bag if there is one, and one accessory only when it defines the look (a statement belt, a brooch, a scarf).

For each piece:
- "type": one word from this list — ${TYPE_LIST}
- "length": for a skirt or a dress "mini", "midi" or "maxi"; for a jacket, coat or trousers "cropped" or "long" when it clearly is; otherwise null
- "colour": one from this list, the nearest — ${COLOUR_LIST}
- "cloth": one from this list when you can see it, otherwise null — ${CLOTH_LIST}
- "detail": up to three plain single words for its cut, texture or decoration, e.g. pencil, slit, fuzzy, oversized, embellished, beaded, checked, sheer, crinkled, pointed, slingback, croc, braided
- "hero": true for the one piece the look is built around, false for the rest

Also give:
- "title": three to six words naming the look's formula, no colours, e.g. "leather midi skirt and fuzzy jumper"
- "summary": one sentence on what makes this look — the pieces, their proportions and textures, and how the colours work together
- "palette": "tonal" when the clothes sit in one colour family or in neighbouring shades of it (mustard with camel, tan and olive is tonal; so is head-to-toe grey), "neutral" when they are a mix of neutrals (black, white, grey, beige, brown, navy), "pop" when a neutral look has one bright piece, "contrast" when two or more distinct colours are set against each other

Reply with JSON only: {"fashion": true or false, "title": "…", "summary": "…", "palette": "…", "pieces": [{"type": "…", "length": null, "colour": "…", "cloth": null, "detail": ["…"], "hero": true}]}. "fashion" is false when the picture does not show an outfit.`

const word = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[^a-z\s-]/g, '') : ''
  return s && s !== 'null' && s !== 'none' ? s : null
}

const GARMENT_SLOTS = new Set<Slot>(['outerwear', 'top', 'bottom', 'dress'])
const LENGTH_ON_TYPE = new Set(['mini', 'midi', 'maxi'])

/** The words for one piece, as the sentence reader takes them. */
function phrase(p: InspirationPiece, opts: { colour: string | null; details: boolean; cloth: boolean }): string {
  const dressOrSkirt = /^(skirt|dress)$/.test(p.type)
  // "cropped" and "long" are held strictly by the sentence reader. On a piece
  // that is special for its decoration (a beaded jacket that happens to be
  // cropped) that would shut out every beaded jacket that isn't — the length
  // is left to rank the anchors instead (signatureScore).
  const strict = !LENGTH_ON_TYPE.has(p.length ?? '')
  const length = p.length && (strict ? !ledByDecoration(p) : dressOrSkirt) ? p.length : null
  // A word of detail that is itself a garment word ("flat" boots, a "top"-handle bag) would be read as a second piece.
  const details = p.detail.filter((d) => !d.split('-').some((w) => Object.hasOwn(TYPE, w))).slice(0, 2)
  return [opts.colour, opts.cloth ? p.cloth : null, ...(opts.details ? details : []), length, p.type].filter(Boolean).join(' ')
}

/** The piece as one spec, or null when the reader can't place its words. */
function specOf(text: string) {
  const pieces = parseOutfitAsk(text, []).pieces
  return pieces.length === 1 && pieces[0].itemTypes.length > 0 ? pieces[0] : null
}

/** The fullest wording of a piece the sentence reader still reads as that one piece. */
function wording(p: InspirationPiece, colour: string | null): string | null {
  for (const o of [{ details: true, cloth: true }, { details: false, cloth: true }, { details: false, cloth: false }]) {
    const text = phrase(p, { colour, ...o })
    if (specOf(text)) return text
  }
  return colour ? wording(p, null) : null
}

/** The item types a piece of the picture may be, as the sentence reader places it. */
export function pieceItemTypes(p: InspirationPiece): string[] {
  const text = wording(p, null)
  return text ? specOf(text)?.itemTypes ?? [] : []
}

/** The piece in the eye's own words: "ivory organza sheer embellished midi skirt". */
export const pieceLabel = (p: InspirationPiece) => [p.colour, p.cloth, ...p.detail, p.length, p.type].filter(Boolean).join(' ')

const knownColour = (c: string | null | undefined): string | null => {
  const s = (c ?? '').trim().toLowerCase()
  return s && Object.hasOwn(COLOUR, s) ? s : null
}

/**
 * An ask for the look. `colours`: 'own' names each piece's colour as in the
 * picture; 'none' names no colour; a colour word dresses the garments in it
 * (the tonal look in another colour) and leaves the shoes and bag open.
 */
export function askForLook(pieces: InspirationPiece[], colours: 'own' | 'none' | string): string {
  const parts: string[] = []
  for (const p of pieces) {
    const colour = colours === 'own' ? knownColour(p.colour) : colours === 'none' ? null : (p.slot && GARMENT_SLOTS.has(p.slot) ? knownColour(colours) : null)
    const text = wording(p, colour)
    if (text) parts.push(text)
  }
  return parts.join(', ')
}

/** The eye's JSON as a look: pieces the composer can place, one per slot, hero first. */
export function parseLookRead(raw: string): { title: string; summary: string; palette: InspirationPalette | null; pieces: InspirationPiece[]; fashion: boolean } | null {
  const first = raw.indexOf('{'); const last = raw.lastIndexOf('}')
  if (first === -1 || last <= first) return null
  let j: any
  try { j = JSON.parse(raw.slice(first, last + 1)) } catch { return null }
  const out: InspirationPiece[] = []
  const taken = new Set<Slot>()
  const rows = (Array.isArray(j.pieces) ? j.pieces : []) as any[]
  rows.sort((a, b) => Number(!!b?.hero) - Number(!!a?.hero))
  for (const r of rows) {
    const type = word(r?.type)
    if (!type) continue
    const piece: InspirationPiece = {
      type,
      length: word(r?.length),
      colour: word(r?.colour),
      cloth: word(r?.cloth),
      detail: (Array.isArray(r?.detail) ? r.detail : []).map(word).filter((d: string | null): d is string => !!d && !d.includes(' ')).slice(0, 3),
      hero: !!r?.hero,
      slot: null,
    }
    const text = wording(piece, null)
    const spec = text ? specOf(text) : null
    if (!spec) continue
    const slot = slotOfPiece(spec) ?? slotForItemType(spec.itemTypes[0] as any)
    // One piece per part of the body: a second top or a second pair of shoes can't be worn with the first.
    if (taken.has(slot)) continue
    if ((slot === 'dress' && (taken.has('top') || taken.has('bottom'))) || ((slot === 'top' || slot === 'bottom') && taken.has('dress'))) continue
    taken.add(slot)
    piece.slot = slot
    out.push(piece)
    if (out.length >= 5) break
  }
  // The look leads with a garment: the composer builds from the first one.
  out.sort((a, b) => Number(GARMENT_SLOTS.has(b.slot as Slot) && b.hero) - Number(GARMENT_SLOTS.has(a.slot as Slot) && a.hero))
  const palette = word(j.palette)
  return {
    fashion: j.fashion !== false,
    title: typeof j.title === 'string' ? j.title.trim().slice(0, 80) : '',
    summary: typeof j.summary === 'string' ? j.summary.trim().slice(0, 400) : '',
    palette: palette === 'tonal' || palette === 'neutral' || palette === 'contrast' || palette === 'pop' ? palette : null,
    pieces: out,
  }
}

/** The project's record of a read picture, or why it can't be composed from. */
export function inspirationFromRead(imageUrl: string, raw: string): InspirationIntake {
  const read = parseLookRead(raw)
  if (!read) return { error: 'MYRA could not read that picture — try one that shows the whole outfit' }
  if (!read.fashion || read.pieces.length === 0) return { read: read.summary || null, error: 'MYRA cannot see an outfit in that picture' }
  if (!read.pieces.some((p) => p.slot && GARMENT_SLOTS.has(p.slot))) return { read: read.summary || null, error: 'MYRA can see accessories but no clothes in that picture' }
  const close_ask = askForLook(read.pieces, 'own')
  const style_ask = askForLook(read.pieces, 'none')
  if (!style_ask) return { read: read.summary || null, error: 'MYRA read the picture but could not put its pieces into words the composer knows' }
  const lead = read.pieces[0]
  const title = read.title || [lead.cloth, lead.length, lead.type].filter(Boolean).join(' ')
  const inspiration: ProjectInspiration = { image_url: imageUrl, title, summary: read.summary, palette: read.palette, pieces: read.pieces, close_ask, style_ask }
  return { inspiration, read: read.summary || null, message: `Read as ${style_ask}` }
}

export async function intakeInspiration(bytes: Buffer, contentType: string): Promise<InspirationIntake> {
  if (!cloudinaryConfigured()) return { error: 'Saving pictures is not set up on the server yet' }
  if (!process.env.OPENAI_API_KEY) return { error: 'MYRA cannot read pictures on the server yet (no OPENAI_API_KEY)' }
  const hosted = await uploadImageBytesToCloudinary(bytes, contentType || 'image/png', { folder: 'review-inspiration', publicId: `look-${Date.now()}` })
  if (!hosted) return { error: 'Could not keep that picture — try again' }
  const r = await readWordFromImage(hosted, LOOK_PROMPT, { maxTokens: 700, detail: 'high' })
  if (r.error) console.error('[review-inspiration] read', r.error)
  if (!r.word) return { error: 'MYRA could not read that picture — try again in a moment' }
  return inspirationFromRead(hosted, r.word)
}

// What a word of character looks like in a product's name: the shops rarely
// say "embellished" — they say beaded, crystal, pearl, sequin.
const DETAIL_FAMILIES: string[][] = [
  ['embellished', 'embellishment', 'beaded', 'bead', 'beads', 'crystal', 'crystals', 'jewel', 'jewelled', 'jeweled', 'pearl', 'pearls', 'sequin', 'sequins', 'sequinned', 'studded', 'gem'],
  ['embroidered', 'embroidery', 'applique', 'appliqué', 'handworked'],
  ['fuzzy', 'fluffy', 'brushed', 'mohair', 'alpaca', 'angora', 'boucle', 'bouclé', 'teddy'],
  ['sheer', 'organza', 'tulle', 'mesh', 'chiffon', 'voile', 'transparent'],
  ['checked', 'check', 'checks', 'plaid', 'tartan', 'gingham', 'houndstooth'],
  ['pleated', 'pleat', 'pleats'],
  ['braided', 'woven', 'plaited'],
  ['crinkled', 'crinkle', 'textured', 'crushed', 'plisse', 'plissé'],
  ['quilted', 'padded'],
  ['striped', 'stripe', 'stripes', 'pinstripe'],
  ['metallic', 'lame', 'lamé', 'foil', 'silver', 'gold'],
  // Cut, from here down: how a piece is shaped rather than what it is made special by.
  ['pencil', 'straight', 'column', 'fitted'],
  ['oversized', 'boxy', 'relaxed', 'slouchy', 'cocoon'],
  ['cropped', 'crop', 'short', 'shrunken'],
]
const CUT_FAMILIES_FROM = DETAIL_FAMILIES.length - 3
/** A piece whose first word is decoration or texture (beaded, fuzzy, checked), not cut. */
const ledByDecoration = (p: InspirationPiece) => {
  const i = DETAIL_FAMILIES.findIndex((f) => f.includes(p.detail[0] ?? ''))
  return i !== -1 && i < CUT_FAMILIES_FROM
}
const foldName = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * How much of a piece's character a product's name carries: its first word of
 * detail counts most (the eye leads with what defines the piece), each word
 * matched by itself or by what the shops call it.
 */
export function signatureScore(productName: string | null | undefined, piece: InspirationPiece): number {
  const name = ` ${foldName(String(productName ?? ''))} `
  let s = 0
  piece.detail.forEach((d, i) => {
    const family = DETAIL_FAMILIES.find((f) => f.includes(d)) ?? [d]
    if (family.some((w) => name.includes(` ${foldName(w)} `))) s += i === 0 ? 2 : 1
  })
  if (piece.cloth && name.includes(` ${piece.cloth} `)) s += 0.5
  if (piece.length) {
    const family = DETAIL_FAMILIES.find((f) => f.includes(piece.length!)) ?? [piece.length]
    if (family.some((w) => name.includes(` ${foldName(w)} `))) s += 0.5
  }
  return s
}

/** The anchors that carry the lead piece's character first, in their given order within a tie. */
export function bySignature<T extends { product_name: string }>(pool: T[], lead: InspirationPiece | undefined): T[] {
  if (!lead) return pool
  return pool.map((a, i) => ({ a, i, s: signatureScore(a.product_name, lead) })).sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.a)
}

/**
 * The anchors to choose `n` from. When enough of them carry the lead piece's
 * defining word (the beaded jackets, the brushed knits), only those — a colour
 * is never worth a piece that has lost the look. Otherwise the best-ranked few.
 */
export function strongestBySignature<T extends { product_name: string }>(pool: T[], lead: InspirationPiece | undefined, n: number): T[] {
  const ranked = bySignature(pool, lead)
  if (!lead) return ranked.slice(0, n * 2 + 2)
  const defining = ranked.filter((a) => signatureScore(a.product_name, lead) >= 2)
  return defining.length >= n ? defining.slice(0, n * 3) : ranked.slice(0, n * 2 + 2)
}

/**
 * `n` anchors spread across colours: the best match of each colour first, then
 * the second of each, so a style comes back in more than black.
 */
export function spreadByColour<T extends { item_id: string; colour_family?: string | null }>(pool: T[], n: number): T[] {
  const byColour = new Map<string, T[]>()
  for (const a of pool) {
    const c = (a.colour_family ?? '').toLowerCase() || '?'
    if (!byColour.has(c)) byColour.set(c, [])
    byColour.get(c)!.push(a)
  }
  const out: T[] = []
  for (let round = 0; out.length < n; round++) {
    let added = false
    for (const list of Array.from(byColour.values())) {
      if (list[round] && out.length < n) { out.push(list[round]); added = true }
    }
    if (!added) break
  }
  return out
}

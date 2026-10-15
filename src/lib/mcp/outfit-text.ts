// AN OUTFIT, WRITTEN OUT FOR AN ASSISTANT.
//
// Pure text, no server imports, so the shape of what Claude or ChatGPT reads
// can be tested. Every piece carries its picture as a markdown image on the
// line below it: an assistant that copies the line shows her the piece, and a
// list of brand names with links is one she never clicks.

export interface OutfitPiece {
  name: string
  brand: string
  price_gbp: number | null
  owned: boolean
  url: string | null
  image_url: string | null
}

export interface OutfitText {
  pieces: OutfitPiece[]
  why: string
}

const clean = (s: string) => String(s ?? '').replace(/[\[\]\n]/g, ' ').replace(/\s+/g, ' ').trim()

/** `![Sézane — Dan Trousers](https://…)`, or nothing when MYRA has no picture. */
export const pictureLine = (p: Pick<OutfitPiece, 'brand' | 'name' | 'image_url'>): string =>
  p.image_url ? `![${clean(p.brand)} — ${clean(p.name)}](${p.image_url})` : ''

export const lineFor = (p: OutfitPiece): string =>
  `${p.owned ? '◈ ' : ''}${p.brand} — ${p.name}${p.owned ? ' (hers already)' : p.price_gbp != null ? ` · £${Math.round(p.price_gbp)}` : ''}${p.url ? ` · ${p.url}` : ''}`

/** One look: a heading, each piece with its picture under it, then why. */
export const outfitToText = (o: OutfitText, i: number): string =>
  [
    `Look ${i + 1}`,
    ...o.pieces.flatMap((p) => [`  ${lineFor(p)}`, pictureLine(p) ? `  ${pictureLine(p)}` : '']),
    o.why ? `  Why: ${o.why}` : '',
  ].filter(Boolean).join('\n')

/** The note at the top of every answer that carries pieces: how to show them. */
export const SHOW_PICTURES =
  'Show her the pictures: copy each ![…](…) line into your reply, under the piece it belongs to, so she sees every piece — names and links alone are not enough.'

/** The pieces with pictures across these looks, in order, each picture once. */
export const picturesOf = (looks: OutfitText[], max = 24): { url: string; caption: string }[] => {
  const seen = new Set<string>()
  const out: { url: string; caption: string }[] = []
  for (const l of looks) for (const p of l.pieces) {
    if (!p.image_url || seen.has(p.image_url)) continue
    seen.add(p.image_url)
    out.push({ url: p.image_url, caption: `${p.owned ? '◈ ' : ''}${clean(p.brand)} — ${clean(p.name)}` })
    if (out.length >= max) return out
  }
  return out
}

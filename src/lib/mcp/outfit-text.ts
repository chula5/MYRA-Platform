// AN OUTFIT, WRITTEN OUT FOR AN ASSISTANT.
//
// Pure text, no server imports, so the shape of what Claude or ChatGPT reads
// can be tested. A look is one picture — the piece it was built around, worn
// on the model, which is the outfit styled — with the pieces listed under it.
// The picture goes as a markdown image line straight under the heading: an
// assistant that copies it shows her the look; a list of names and links is
// one she never clicks, and a picture per piece is a column of cut-outs.

export interface OutfitPiece {
  name: string
  brand: string
  price_gbp: number | null
  owned: boolean
  url: string | null
  image_url: string | null
  /** MYRA's own id for the piece, so a heart in an assistant can save it. */
  item_id?: string | null
}

export interface OutfitText {
  pieces: OutfitPiece[]
  why: string
  /** The look shot styled on a model, where MYRA has one; else the anchor piece stands in. */
  picture_url?: string | null
}

const clean = (s: string) => String(s ?? '').replace(/[\[\]\n]/g, ' ').replace(/\s+/g, ' ').trim()

/** `![Sézane — Dan Trousers](https://…)`, or nothing when MYRA has no picture. */
export const pictureLine = (p: Pick<OutfitPiece, 'brand' | 'name' | 'image_url'>): string =>
  p.image_url ? `![${clean(p.brand)} — ${clean(p.name)}](${p.image_url})` : ''

/**
 * The picture that shows the look: the piece the outfit was composed around
 * comes first and is photographed worn, so it is the styled outfit. A look
 * whose first piece has no picture falls back to the first piece that does.
 */
export const lookPicture = (o: OutfitText): OutfitPiece | null =>
  o.picture_url
    ? { name: 'styled on a model', brand: 'MYRA', price_gbp: null, owned: false, url: null, image_url: o.picture_url }
    : o.pieces.find((p) => p.image_url) ?? null

export const lineFor = (p: OutfitPiece): string =>
  `${p.owned ? '◈ ' : ''}${p.brand} — ${p.name}${p.owned ? ' (hers already)' : p.price_gbp != null ? ` · £${Math.round(p.price_gbp)}` : ''}${p.url ? ` · ${p.url}` : ''}`

/** One look: a heading, the look's picture once, each piece under it, then why. */
export const outfitToText = (o: OutfitText, i: number): string => {
  const hero = lookPicture(o)
  const picture = hero ? pictureLine({ brand: `Look ${i + 1}`, name: `${clean(hero.brand)} ${clean(hero.name)}`, image_url: hero.image_url }) : ''
  return [
    `Look ${i + 1}`,
    picture ? `  ${picture}` : '',
    ...o.pieces.map((p) => `  ${lineFor(p)}`),
    o.why ? `  Why: ${o.why}` : '',
  ].filter(Boolean).join('\n')
}

/** The note at the top of every answer that carries looks: how to show them. */
export const SHOW_PICTURES =
  'Show her each look: copy the ![…](…) line under each Look heading into your reply (it is the outfit, styled), then list that look\'s pieces under the picture with their prices and links. One picture per look — do not add a picture per piece — and never names and links alone.'

/** One picture per look, in order: the look's picture, captioned with its number. */
export const picturesOf = (looks: OutfitText[], max = 24): { url: string; caption: string }[] => {
  const out: { url: string; caption: string }[] = []
  looks.forEach((l, i) => {
    const hero = lookPicture(l)
    if (!hero?.image_url || out.length >= max) return
    out.push({ url: hero.image_url, caption: `Look ${i + 1} — ${l.pieces.map((p) => `${p.owned ? '◈ ' : ''}${clean(p.brand)} ${clean(p.name)}`).join(' · ')}` })
  })
  return out
}

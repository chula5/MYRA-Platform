// A STYLIST'S BRIEF — what she reaches for, and what she never does.
//
// The moodboard teaches a stylist's eye as numbers (an envelope over 34
// dims); the brief says the rest in words: her signature pieces, brands and
// palette, her NEVERS, and the one line that separates her from the stylist
// she is most easily confused with. Numbers cannot tell a tweed jacket from
// a blazer — the brief can.
//
// Pure. Read by the composer (bans gate, preferences score), by the look
// check and chat prompts (as text), and by Sciura when she routes.

export type NeverKind = 'ban' | 'preference'

export interface StylistNever {
  text: string
  /** ban = a look with this in it never shows; preference = it scores lower. */
  kind: NeverKind
  /** Words matched, lower-case, against a piece's name, type, material, colour and brand. */
  match: string[]
}

export interface StylistSibling {
  slug: string
  /** The one line Sciura reads out: how THIS stylist differs from that one. */
  difference: string
}

export interface StylistBrief {
  public_name: string
  tagline: string
  image_url?: string | null
  signature_pieces: string[]
  brands: string[]
  palette: string[]
  fabrics: string[]
  day?: string
  evening?: string
  weekend?: string
  nevers: StylistNever[]
  siblings: StylistSibling[]
  how_she_routes?: string
}

const strs = (x: unknown): string[] => (Array.isArray(x) ? x.map((s) => String(s ?? '').trim()).filter(Boolean) : [])

/** A brief from jsonb — every field present, nothing trusted. */
export function parseBrief(raw: unknown, fallbackName = ''): StylistBrief {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    public_name: String(r.public_name ?? fallbackName ?? '').trim() || fallbackName,
    tagline: String(r.tagline ?? '').trim(),
    image_url: typeof r.image_url === 'string' && r.image_url ? r.image_url : null,
    signature_pieces: strs(r.signature_pieces),
    brands: strs(r.brands),
    palette: strs(r.palette),
    fabrics: strs(r.fabrics),
    day: typeof r.day === 'string' ? r.day : undefined,
    evening: typeof r.evening === 'string' ? r.evening : undefined,
    weekend: typeof r.weekend === 'string' ? r.weekend : undefined,
    nevers: (Array.isArray(r.nevers) ? r.nevers : [])
      .map((n: any) => ({
        text: String(n?.text ?? '').trim(),
        kind: (n?.kind === 'preference' ? 'preference' : 'ban') as NeverKind,
        match: strs(n?.match).map((m) => m.toLowerCase()),
      }))
      .filter((n) => n.text),
    siblings: (Array.isArray(r.siblings) ? r.siblings : [])
      .map((s: any) => ({ slug: String(s?.slug ?? '').trim(), difference: String(s?.difference ?? '').trim() }))
      .filter((s) => s.slug && s.difference),
    how_she_routes: typeof r.how_she_routes === 'string' ? r.how_she_routes : undefined,
  }
}

/** Has this brief been written, or is it still the empty default? */
export const briefIsEmpty = (b: StylistBrief): boolean =>
  !b.signature_pieces.length && !b.brands.length && !b.nevers.length && !b.tagline

/** The words a never is matched against, for one piece. */
export interface BriefPiece {
  product_name?: string | null
  item_type?: string | null
  material_primary?: string | null
  material_category?: string | null
  colour_family?: string | null
  print_flag?: string | null
  brand_name?: string | null
}

export const pieceText = (p: BriefPiece): string =>
  [p.product_name, p.item_type, p.material_primary, p.material_category, p.colour_family, p.print_flag, p.brand_name]
    .filter(Boolean).join(' ').toLowerCase().replace(/_/g, ' ')

const hits = (text: string, n: StylistNever): boolean => n.match.some((m) => m && text.includes(m))

export interface BriefJudgement {
  /** A ban matched: the look never shows. */
  blocked: boolean
  /** Which nevers matched, with the piece that tripped each. */
  violations: { never: StylistNever; piece: string }[]
  /** 0..1 taken off the score for matched preferences. */
  penalty: number
}

/** How much one matched preference costs a look. */
export const BRIEF_PREFERENCE_PENALTY = 0.12

/** Judge a look's pieces against a brief's nevers. Empty brief → nothing happens. */
export function judgeAgainstBrief(pieces: BriefPiece[], brief: StylistBrief | null | undefined): BriefJudgement {
  const out: BriefJudgement = { blocked: false, violations: [], penalty: 0 }
  if (!brief?.nevers.length) return out
  for (const p of pieces) {
    const text = pieceText(p)
    for (const n of brief.nevers) {
      if (!n.match.length || !hits(text, n)) continue
      out.violations.push({ never: n, piece: p.product_name ?? p.item_type ?? '' })
      if (n.kind === 'ban') out.blocked = true
      else out.penalty = Math.min(1, out.penalty + BRIEF_PREFERENCE_PENALTY)
    }
  }
  return out
}

/** Does a single piece match a brand or signature word in the brief? (for search + routing) */
export function briefAffinity(p: BriefPiece, brief: StylistBrief): number {
  const text = pieceText(p)
  let n = 0
  if (p.brand_name && brief.brands.some((b) => b.toLowerCase() === p.brand_name!.toLowerCase())) n += 2
  for (const s of brief.signature_pieces) {
    const words = s.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    if (words.length && words.every((w) => text.includes(w))) { n += 1; break }
  }
  if (brief.fabrics.some((f) => text.includes(f.toLowerCase()))) n += 0.5
  return n
}

/** The brief as a prompt reads it — one paragraph, her nevers stated as rules. */
export function briefText(name: string, brief: StylistBrief): string {
  const list = (label: string, xs: string[]) => (xs.length ? `${label}: ${xs.join(', ')}.` : '')
  const bans = brief.nevers.filter((n) => n.kind === 'ban').map((n) => n.text)
  const prefs = brief.nevers.filter((n) => n.kind === 'preference').map((n) => n.text)
  return [
    `${brief.public_name || name}${brief.tagline ? ` — ${brief.tagline}` : ''}.`,
    list('Signature pieces', brief.signature_pieces),
    list('Brands', brief.brands),
    list('Palette', brief.palette),
    list('Fabrics', brief.fabrics),
    brief.day ? `Day: ${brief.day}` : '',
    brief.evening ? `Evening: ${brief.evening}` : '',
    brief.weekend ? `Weekend: ${brief.weekend}` : '',
    bans.length ? `Never (a look that breaks one of these is wrong): ${bans.join('; ')}.` : '',
    prefs.length ? `Avoids where she can: ${prefs.join('; ')}.` : '',
  ].filter(Boolean).join(' ')
}

/** Cosine between two vectors, 0 when either is missing. */
export function cosine(a?: number[] | null, b?: number[] | null): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/**
 * Two stylists whose eyes (envelope means) sit this close cannot be told apart
 * by numbers — only their briefs separate them. Shown in the admin as OVERLAP.
 */
export const OVERLAP_COSINE = 0.92

export interface Overlap {
  slug: string
  name: string
  cosine: number | null
  /** The difference line written for this pair, if any. */
  difference: string | null
  /** Named as a sibling in the brief, or found by the numbers. */
  named: boolean
}

export function overlapsFor(
  me: { slug: string; brief: StylistBrief; mean?: number[] | null },
  others: { slug: string; name: string; brief: StylistBrief; mean?: number[] | null }[],
): Overlap[] {
  const out: Overlap[] = []
  for (const o of others) {
    if (o.slug === me.slug) continue
    const sib = me.brief.siblings.find((s) => s.slug === o.slug)
    const c = me.mean && o.mean ? cosine(me.mean, o.mean) : null
    if (!sib && (c == null || c < OVERLAP_COSINE)) continue
    out.push({ slug: o.slug, name: o.brief.public_name || o.name, cosine: c, difference: sib?.difference ?? null, named: !!sib })
  }
  return out.sort((a, b) => (b.cosine ?? 0) - (a.cosine ?? 0))
}

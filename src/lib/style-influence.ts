// ── STYLE INFLUENCES ────────────────────────────────────────────────────────
// The people whose style a client loves — a celebrity, an influencer, a muse,
// a house's look — kept as people with pictures and a brief in words.
//
// The layering (see house base): house (Chloe) → persona → INFLUENCES → her own
// evidence. An influence is reference, never a stylist: it composes for no one
// and learns from no one's yes/no. One person is shared by every member who
// names them, so Gillian Anderson is scored once and read by all of them.
//
// This module is pure (types, parsing, words) so pages can use it too; the
// database side lives in lib/style-influence-store.ts.

export type InfluenceKind = 'celebrity' | 'influencer' | 'muse' | 'house'
export type InfluenceStatus = 'draft' | 'live'

export const INFLUENCE_KINDS: { id: InfluenceKind; label: string }[] = [
  { id: 'celebrity', label: 'Celebrity' },
  { id: 'influencer', label: 'Influencer' },
  { id: 'muse', label: 'Muse' },
  { id: 'house', label: 'House style' },
]

export interface InfluenceBrief {
  /** One or two sentences: what her style IS. */
  summary: string
  /** The pieces and moves she is known for. */
  signatures: string[]
  palette: string[]
  silhouettes: string[]
  /** What she would never wear — read by the look check, never a hard gate. */
  nevers: string[]
}

export interface StyleInfluence {
  influence_id: string
  name: string
  slug: string
  kind: InfluenceKind
  handle: string | null
  image_url: string | null
  brief: InfluenceBrief
  status: InfluenceStatus
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []

export function parseInfluenceBrief(raw: unknown): InfluenceBrief {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    summary: typeof r.summary === 'string' ? r.summary.trim() : '',
    signatures: list(r.signatures),
    palette: list(r.palette),
    silhouettes: list(r.silhouettes),
    nevers: list(r.nevers),
  }
}

export function influenceBriefIsEmpty(b: InfluenceBrief): boolean {
  return !b.summary && !b.signatures.length && !b.palette.length && !b.silhouettes.length && !b.nevers.length
}

/** One influence in the words the look check and her memory read. */
export function influenceBriefText(name: string, b: InfluenceBrief): string {
  const parts = [
    b.summary,
    b.signatures.length ? `Signatures: ${b.signatures.join(', ')}.` : '',
    b.silhouettes.length ? `Shapes: ${b.silhouettes.join(', ')}.` : '',
    b.palette.length ? `Palette: ${b.palette.join(', ')}.` : '',
    b.nevers.length ? `Never: ${b.nevers.join(', ')}.` : '',
  ].filter(Boolean)
  return `${name}${parts.length ? ` — ${parts.join(' ')}` : ''}`
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'influence'
}

/** Lines in a textarea ↔ a list. Commas also split, so "black, navy" works. */
export const linesToList = (s: string): string[] =>
  s.split(/\n|,/).map((x) => x.trim()).filter(Boolean)

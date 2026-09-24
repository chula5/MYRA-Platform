// SCIURA — the chief stylist. She styles nothing; she decides who does.
//
// She reads what a member has shown MYRA — the pictures she keeps, the
// pieces in her dressing room, the brands she named — and holds each against
// every stylist in the house: the stylist's eye (her envelope, from confirmed
// reference outfits), her brands, her signature pieces. The result is a
// primary stylist, a blend, and ONE line of reason. The line never waffles
// because it is not written: it is the difference the primary's brief already
// states against her nearest sibling.
//
// A proposal, never an assignment: Chloe applies it in /admin/stylists.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { listStylists, type Stylist } from '@/lib/stylist-store'
import { briefAffinity, cosine, type StylistBrief } from '@/lib/stylist-brief'
import { listOwnedItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'

export interface RoutingCandidate {
  stylist_id: string
  slug: string
  name: string
  public_name: string
  score: number
  share: number
  /** Where the score came from, for the admin card. */
  parts: { eye: number; brands: number; pieces: number }
}

export interface Routing {
  member_id: string
  primary: RoutingCandidate | null
  blend: RoutingCandidate[]
  reason: string
  evidence: { pictures: number; pieces: number; brands: number; scoredStylists: number }
  computed_at: string
  applied_at?: string | null
}

// How the three readings weigh. Her eye counts most once a stylist has a
// confirmed envelope; a stylist without one is judged on brands and pieces
// alone, and the card says so.
const W_EYE = 0.5
const W_BRANDS = 0.3
const W_PIECES = 0.2
/** A second stylist enters the blend when she scores at least this much of the primary. */
const BLEND_FLOOR = 0.6

function mean(vectors: number[][]): number[] | null {
  const ok = vectors.filter((v) => Array.isArray(v) && v.length)
  if (!ok.length) return null
  const n = ok[0].length
  const out = new Array(n).fill(0)
  for (const v of ok) for (let i = 0; i < n; i++) out[i] += v[i] ?? 0
  return out.map((x) => x / ok.length)
}

/** The stylists Sciura can route to: personas with a brief, never herself, never Chloe. */
export async function routableStylists(): Promise<Stylist[]> {
  const all = await listStylists()
  return all.filter((s) => s.type === 'persona' && s.role === 'stylist' && (s.brief.brands.length || s.brief.signature_pieces.length))
}

/** Read her, score every stylist, and write the proposal. */
export async function routeMember(memberId: string): Promise<Routing | { error: string }> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id, brands').eq('member_id', memberId).maybeSingle()
  if (!member) return { error: 'No member' }

  const owners = [memberId, member.auth_user_id].filter(Boolean)
  const [{ data: refs }, { data: archival }, owned, { data: affinities }, stylists] = await Promise.all([
    admin.from('inspiration_image').select('vector').in('user_id', owners).in('status', ['scored', 'confirmed']),
    admin.from('archival_look').select('taste_vector').eq('member_id', memberId).eq('hidden', false).not('taste_vector', 'is', null),
    listOwnedItems(ownerRefsForMember({ member_id: memberId, auth_user_id: member.auth_user_id })).catch(() => [] as any[]),
    admin.from('user_brand_affinity').select('affinity, hidden, brand:brand_id(name)').eq('user_id', memberId),
    routableStylists(),
  ])

  const pictures = [
    ...((refs ?? []) as any[]).map((r) => r.vector),
    ...((archival ?? []) as any[]).map((r) => r.taste_vector),
  ].filter((v) => Array.isArray(v) && v.length)
  const herEye = mean(pictures)

  // Her brands: the ones she named (rank-weighted) and the ones she has warmed to.
  const brandWeight = new Map<string, number>()
  const named = (Array.isArray(member.brands) ? member.brands : []) as { name: string; rank: number }[]
  const n = named.length
  for (const b of named) brandWeight.set(b.name.toLowerCase(), Math.max(brandWeight.get(b.name.toLowerCase()) ?? 0, n ? (n - b.rank + 1) / n : 1))
  for (const a of (affinities ?? []) as any[]) {
    const nm = a.brand?.name?.toLowerCase()
    if (nm && !a.hidden && typeof a.affinity === 'number') brandWeight.set(nm, Math.max(brandWeight.get(nm) ?? 0, a.affinity))
  }

  const pieces = (owned as any[]).map((it) => ({
    product_name: it.product_name, item_type: it.item_type, material_primary: it.material_primary,
    material_category: it.material_category, colour_family: it.colour_family, brand_name: it.brand?.name ?? it.brand_name ?? null,
  }))

  const scored: RoutingCandidate[] = stylists.map((s) => {
    const stylistEye = s.envelope?.mean?.length ? s.envelope.mean : s.centroid
    const eye = herEye && stylistEye ? Math.max(0, cosine(herEye, stylistEye)) : 0
    const brands = brandOverlap(brandWeight, s.brief)
    const pcs = pieces.length ? Math.min(1, pieces.reduce((acc, p) => acc + briefAffinity(p, s.brief), 0) / Math.max(4, pieces.length)) : 0
    // Without an eye on either side the other two carry the whole weight.
    const hasEye = !!(herEye && stylistEye)
    const score = hasEye ? W_EYE * eye + W_BRANDS * brands + W_PIECES * pcs : (W_BRANDS * brands + W_PIECES * pcs) / (W_BRANDS + W_PIECES)
    return { stylist_id: s.stylist_id, slug: s.slug, name: s.name, public_name: s.brief.public_name || s.name, score, share: 0, parts: { eye, brands, pieces: pcs } }
  }).sort((a, b) => b.score - a.score)

  const primary = scored[0]?.score > 0 ? scored[0] : null
  const blend = primary
    ? scored.filter((c) => c.score >= primary.score * BLEND_FLOOR).slice(0, 3)
    : []
  const total = blend.reduce((a, c) => a + c.score, 0) || 1
  for (const c of blend) c.share = Math.round((c.score / total) * 100)

  const reason = routingReason(primary, blend, stylists, { pictures: pictures.length, pieces: pieces.length, brands: brandWeight.size })
  const routing: Routing = {
    member_id: memberId, primary, blend, reason,
    evidence: { pictures: pictures.length, pieces: pieces.length, brands: brandWeight.size, scoredStylists: scored.length },
    computed_at: new Date().toISOString(),
  }
  await admin.from('stylist_routing').upsert({
    member_id: memberId,
    primary_stylist_id: primary?.stylist_id ?? null,
    blend: blend.map((c) => ({ stylist_id: c.stylist_id, slug: c.slug, name: c.public_name, share: c.share, score: Number(c.score.toFixed(3)) })),
    reason,
    evidence: routing.evidence,
    computed_at: routing.computed_at,
    applied_at: null,
  })
  return routing
}

function brandOverlap(hers: Map<string, number>, brief: StylistBrief): number {
  if (!hers.size || !brief.brands.length) return 0
  let hit = 0
  for (const b of brief.brands) {
    const w = hers.get(b.toLowerCase())
    if (w) hit += w
  }
  // Three of her brands on the stylist's list is a full match.
  return Math.min(1, hit / 3)
}

/**
 * The one line. Primary, what she was read on, and — when a sibling is close —
 * the difference the primary's brief states against it. Nothing generated.
 */
export function routingReason(
  primary: RoutingCandidate | null,
  blend: RoutingCandidate[],
  stylists: Stylist[],
  evidence: { pictures: number; pieces: number; brands: number },
): string {
  if (!primary) {
    return evidence.pictures + evidence.pieces + evidence.brands === 0
      ? 'Nothing to read yet — no pictures, no pieces, no brands.'
      : 'No stylist matches what she has shown; the stylists need their reference outfits scored first.'
  }
  const read: string[] = []
  if (primary.parts.eye > 0) read.push(`her ${evidence.pictures} picture${evidence.pictures === 1 ? '' : 's'} sit in ${primary.public_name}'s eye`)
  if (primary.parts.brands > 0) read.push(`her brands are ${primary.public_name}'s brands`)
  if (primary.parts.pieces > 0) read.push(`what she owns is what ${primary.public_name} reaches for`)
  const second = blend.find((c) => c.stylist_id !== primary.stylist_id)
  const me = stylists.find((s) => s.stylist_id === primary.stylist_id)
  const sib = second && me?.brief.siblings.find((s) => s.slug === second.slug)
  const parts = [
    `${primary.public_name}${second ? ` (${primary.share}%), with ${second.public_name} (${second.share}%)` : ''}: ${read.join('; ') || 'closest on what little she has shown'}.`,
    sib ? `Not ${second!.public_name} first: ${sib.difference}` : '',
  ]
  return parts.filter(Boolean).join(' ')
}

/** The last proposal made for her, if any. */
export async function loadRouting(memberId: string): Promise<(Routing & { applied_at: string | null }) | null> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('stylist_routing').select('*').eq('member_id', memberId).maybeSingle()
  if (!data) return null
  const blend = (Array.isArray(data.blend) ? data.blend : []) as { stylist_id: string; slug: string; name: string; share: number; score: number }[]
  const cands: RoutingCandidate[] = blend.map((b) => ({
    stylist_id: b.stylist_id, slug: b.slug, name: b.name, public_name: b.name, score: b.score, share: b.share,
    parts: { eye: 0, brands: 0, pieces: 0 },
  }))
  return {
    member_id: memberId,
    primary: cands.find((c) => c.stylist_id === data.primary_stylist_id) ?? null,
    blend: cands,
    reason: data.reason ?? '',
    evidence: { pictures: 0, pieces: 0, brands: 0, scoredStylists: 0, ...(data.evidence ?? {}) },
    computed_at: data.computed_at,
    applied_at: data.applied_at ?? null,
  }
}

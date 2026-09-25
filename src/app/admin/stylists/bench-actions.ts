'use server'

// THE BENCH — one piece, every stylist, side by side.
//
// A house of stylists is only a house if they disagree. This styles ONE item
// for ONE member with only the stylist swapped, so the difference on screen is
// the stylist and nothing else: same library, same size, same occasion, same
// history. If two columns come back identical, they are identical — that is
// the point of the tool, not a fault in it.
//
// What actually makes a stylist differ, so the answer can be read honestly:
//   · brief    — bans gate, preferences score (lib/stylist-brief, in the composer)
//   · envelope — the moodboard's shape, via personaFitScore
// A stylist with neither is styling as the house would. The column says so.

import { createAdminClient } from '@/lib/supabase-server'
import { assertAdmin } from '@/lib/admin-audit'
import { composeMemberVariants, type MemberTaste, type PersonaLens, type ComposeHistory } from '@/lib/pilot-composer'
import { rulesForMember } from '@/lib/style-rules'
import { PERSONA_START_WEIGHT } from '@/lib/user-persona'
import {
  loadComposableLibrary, loadMemberTaste, loadPersonaLens, loadComposeHistory,
} from '@/app/admin/private-stylist/actions'
import { effectiveWeights, normalise, lookTasteVector } from '@/lib/pilot-stylist'
import { parseBrief, briefIsEmpty, type StylistBrief } from '@/lib/stylist-brief'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { OCCASION_LABEL } from '@/lib/client-occasions'

export interface BenchItem {
  item_id: string
  product_name: string
  image_url: string | null
  brand_name: string | null
  item_type: string
}

export interface BenchPiece {
  item_id: string | null
  product_name: string
  brand: string
  image_url: string | null
  price_gbp: number | null
  is_hero: boolean
}

export interface BenchColumn {
  stylist_id: string
  stylist_name: string
  status: string
  /** What this stylist has to style WITH — an empty one styles as the house. */
  has_brief: boolean
  has_envelope: boolean
  pieces: BenchPiece[]
  brands: string[]
  notes: string
  error?: string
}

export interface BenchResult {
  hero?: BenchItem
  occasion_label?: string | null
  /** Null when the bench ran with no client — the stylist alone. */
  member_name?: string | null
  columns: BenchColumn[]
  /** True when every stylist returned the same pieces — the house, wearing name badges. */
  identical?: boolean
  error?: string
}

export async function searchBenchItems(query: string): Promise<{ items: BenchItem[]; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    let req = admin
      .from('item')
      .select('item_id, product_name, image_url, item_type, brand:brand_id(name)')
      .in('status', ['ready', 'live'])
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(40)
    const q = query.trim()
    if (q) req = req.ilike('product_name', `%${q}%`)
    const { data, error } = await req
    if (error) return { items: [], error: error.message }
    return {
      items: (data ?? []).map((r: any) => ({
        item_id: r.item_id,
        product_name: r.product_name,
        image_url: r.image_url ?? null,
        item_type: r.item_type,
        brand_name: r.brand?.name ?? null,
      })),
    }
  } catch (err) {
    return { items: [], error: err instanceof Error ? err.message : 'Search failed' }
  }
}

/** Whose size and library the bench styles in — the comparison needs one client. */
export async function listBenchMembers(): Promise<{ members: { member_id: string; name: string }[]; error?: string }> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const { data, error } = await admin
      .from('pilot_member').select('member_id, name').order('created_at', { ascending: true })
    if (error) return { members: [], error: error.message }
    return { members: (data ?? []).map((m: any) => ({ member_id: m.member_id, name: m.name ?? 'Unnamed' })) }
  } catch (err) {
    return { members: [], error: err instanceof Error ? err.message : 'Load failed' }
  }
}

/**
 * What the bench styles with when no client is chosen: the global rules, the
 * stylist's brief, and nothing else — no preferences, no brand affinity, no
 * history. The client dynamic is real and right for a client; on the bench
 * it was all anyone could see.
 */
function stylistOnlyTaste(brief: StylistBrief | undefined): MemberTaste {
  return {
    affinity: new Map(), families: new Map(), excludedPairs: new Set(), inputOnlyBrands: new Set(),
    itemSwapOut: new Map(), brandSwapOut: new Map(), pairNet: new Map(),
    rules: rulesForMember(null, false),
    brief,
  }
}

export async function styleAcrossStylists(
  itemId: string,
  occasionId: string | null,
  /** null = no client: the stylist alone, over the whole library. */
  memberId: string | null,
): Promise<BenchResult> {
  await assertAdmin()
  try {
    const admin = createAdminClient() as any
    const member = memberId
      ? (await admin.from('pilot_member').select('*').eq('member_id', memberId).single()).data
      : null
    if (memberId && !member) return { columns: [], error: 'Member not found' }

    const { data: stylists } = await admin
      .from('stylist').select('stylist_id, name, status, role, brief, envelope')
      .order('created_at', { ascending: true })
    const bench = (stylists ?? []).filter((s: any) => s.role !== 'chief')
    if (!bench.length) return { columns: [], error: 'No stylists to compare' }

    // With a client: her size, her history. Without one: the whole library,
    // no history — so the only thing that differs between columns is the
    // stylist, and the only thing shared is the piece.
    const library = await loadComposableLibrary(member)
    const hero = library.find((i: any) => i.item_id === itemId)
    if (!hero) return { columns: [], error: member ? 'That piece is not in the library in her size' : 'That piece is not in the library' }
    // The bench is about what each stylist REACHES FOR, so it shops the whole
    // library rather than her wardrobe: two stylists handed the same six owned
    // pieces would agree for reasons that have nothing to do with taste.
    const pool = library.filter((i: any) => !isOwnedItem(i) || i.item_id === itemId) as any[]
    const history: ComposeHistory = member
      ? await loadComposeHistory(admin, member.member_id)
      : { seenCounts: new Map(), rejected: new Set() }
    const occ = occasionId
      ? {
          id: occasionId as any,
          // Her rooms shape the occasion's target; with no client the occasion
          // is its type priors alone — no sneakers at dinner, still.
          vector: member ? lookTasteVector(normalise(effectiveWeights(member.room_weights, occasionId as any, member.work_dress_code))) : null,
          climate: null,
        }
      : undefined

    const dims = new Map<string, any>(pool.map((i: any) => [i.item_id, i]))
    const heroView: BenchItem = {
      item_id: hero.item_id,
      product_name: hero.product_name,
      image_url: hero.image_url ?? null,
      brand_name: hero.brand?.name ?? null,
      item_type: hero.item_type,
    }

    const columns: BenchColumn[] = []
    for (const s of bench) {
      const parsed = parseBrief(s.brief, s.name ?? '')
      const has_brief = !briefIsEmpty(parsed)
      const has_envelope = !!s.envelope?.mean?.length
      const base: BenchColumn = {
        stylist_id: s.stylist_id, stylist_name: s.name, status: s.status,
        has_brief, has_envelope, pieces: [], brands: [], notes: '',
      }
      try {
        // Only the stylist changes between columns. With a client, the persona
        // override carries its rules and brief into her taste and its envelope
        // into her lens; without one, both are built from the stylist alone.
        const [taste, lens] = member
          ? await Promise.all([
              loadMemberTaste(admin, member, { personaId: s.stylist_id }),
              loadPersonaLens(admin, member.member_id, s.stylist_id),
            ])
          : [
              stylistOnlyTaste(has_brief ? parsed : undefined),
              {
                name: s.name,
                envelope: has_envelope ? { mean: s.envelope.mean, spread: s.envelope.spread ?? [] } : null,
                weight: PERSONA_START_WEIGHT,
              } as PersonaLens,
            ]
        const looks = composeMemberVariants(taste, pool as any, hero.item_id, 1, occ, lens, history, { ownedMode: 'retail_only' })
        const look = looks[0]
        if (!look) { columns.push({ ...base, error: 'Nothing this stylist would put with it' }); continue }
        const pieces: BenchPiece[] = look.items.map((it: any) => ({
          item_id: it.item_id ?? null,
          product_name: it.product_name,
          brand: it.brand,
          image_url: dims.get(it.item_id ?? '')?.image_url ?? null,
          price_gbp: it.price_gbp ?? null,
          is_hero: it.item_id === hero.item_id,
        }))
        columns.push({
          ...base,
          pieces,
          brands: Array.from(new Set(pieces.filter((p) => !p.is_hero).map((p) => p.brand).filter(Boolean))),
          notes: look.notes ?? '',
        })
      } catch (err) {
        columns.push({ ...base, error: err instanceof Error ? err.message : 'Compose failed' })
      }
    }

    const signature = (c: BenchColumn) => c.pieces.map((p) => p.item_id).sort().join('|')
    const done = columns.filter((c) => c.pieces.length)
    const identical = done.length > 1 && new Set(done.map(signature)).size === 1

    return {
      hero: heroView,
      occasion_label: occasionId ? (OCCASION_LABEL[occasionId] ?? occasionId) : null,
      member_name: member?.name ?? null,
      columns,
      identical,
    }
  } catch (err) {
    return { columns: [], error: err instanceof Error ? err.message : 'Bench failed' }
  }
}

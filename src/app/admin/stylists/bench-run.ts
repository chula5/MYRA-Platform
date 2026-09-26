// ONE BENCH RUN — one piece, every stylist, with only the stylist changing.
//
// A plain module, not a server action, so both the bench and the trials can
// run it: a 'use server' file may export nothing but actions. Callers gate.
//
// With a client: her size, her history, her taste with the persona swapped in
// per column. Without one: the whole library, no history, and a taste made of
// nothing but the global rules, the stylist's brief and the stylist's own
// Style Brain — so the only thing that differs between columns is the
// stylist, and the only thing shared is the piece.

import 'server-only'
import { composeMemberVariants, type MemberTaste, type PersonaLens, type ComposeHistory, toFeature } from '@/lib/pilot-composer'
import { rulesForMember } from '@/lib/style-rules'
import { PERSONA_START_WEIGHT } from '@/lib/user-persona'
import {
  loadComposableLibrary, loadMemberTaste, loadPersonaLens, loadComposeHistory,
} from '@/app/admin/private-stylist/actions'
import { effectiveWeights, normalise, lookTasteVector } from '@/lib/pilot-stylist'
import { parseBrief, briefIsEmpty, type StylistBrief } from '@/lib/stylist-brief'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { OCCASION_LABEL } from '@/lib/client-occasions'
import { loadStyleModel, recordStyleOffers } from '@/lib/style-brain-store'
import type { StyleModel } from '@/lib/style-brain'
import { scoreBenchColumn, scoreDistinctness, brandsInStock, type BenchScorecard } from '@/lib/stylist-bench'

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
  /** For the never chips: what a NO could be turned into. */
  item_type: string | null
  colour_family: string | null
  material: string | null
}

export interface BenchColumn {
  stylist_id: string
  stylist_name: string
  status: string
  has_brief: boolean
  has_envelope: boolean
  /** Of the brief's brands, how many the library holds at all. */
  brands_in_stock: number
  /** Decisions this stylist's Style Brain has learned from so far. */
  decisions: number
  pieces: BenchPiece[]
  item_ids: string[]
  brands: string[]
  notes: string
  scorecard?: BenchScorecard
  error?: string
}

export interface BenchResult {
  hero?: BenchItem
  occasion_id?: string | null
  occasion_label?: string | null
  /** Null when the bench ran with no client — the stylist alone. */
  member_name?: string | null
  columns: BenchColumn[]
  /** True when every finished column is a twin of every other. */
  identical?: boolean
  summary?: { mean_on_brief: number | null; mean_occasion: number | null; mean_distinct: number | null; house_default_count: number }
  error?: string
}

function stylistOnlyTaste(brief: StylistBrief | undefined, model: StyleModel): MemberTaste {
  return {
    affinity: new Map(), families: new Map(), excludedPairs: new Set(), inputOnlyBrands: new Set(),
    itemSwapOut: new Map(), brandSwapOut: new Map(), pairNet: new Map(),
    rules: rulesForMember(null, false),
    brief,
    // Her own Style Brain, in the slot the composer reads skip-pairs from.
    // Not houseStyleModel as well: styleLearningBonus adds both, and the same
    // model twice would count double. "The stylist alone" means Chloe's model
    // is absent here.
    styleModel: model,
  }
}

const avg = (xs: (number | null | undefined)[]): number | null => {
  const ok = xs.filter((x): x is number => typeof x === 'number')
  return ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null
}

export async function benchRun(
  admin: any,
  itemId: string,
  occasionId: string | null,
  memberId: string | null,
  opts: { offers?: boolean } = {},
): Promise<BenchResult> {
  const member = memberId
    ? (await admin.from('pilot_member').select('*').eq('member_id', memberId).single()).data
    : null
  if (memberId && !member) return { columns: [], error: 'Member not found' }

  const { data: stylists } = await admin
    .from('stylist').select('stylist_id, name, status, role, brief, envelope')
    .order('created_at', { ascending: true })
  const bench = (stylists ?? []).filter((s: any) => s.role !== 'chief')
  if (!bench.length) return { columns: [], error: 'No stylists to compare' }

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
    item_id: hero.item_id, product_name: hero.product_name, image_url: hero.image_url ?? null,
    brand_name: hero.brand?.name ?? null, item_type: hero.item_type,
  }
  // Each stylist's own Style Brain, once, before the loop.
  const models = await Promise.all(bench.map((s: any) => loadStyleModel(s.stylist_id)))

  const columns: BenchColumn[] = []
  const offers: { stylistId: string; items: any[]; itemIds: string[] }[] = []
  for (let k = 0; k < bench.length; k++) {
    const s = bench[k]
    const model = models[k]
    const parsed = parseBrief(s.brief, s.name ?? '')
    const has_brief = !briefIsEmpty(parsed)
    const has_envelope = !!s.envelope?.mean?.length
    const base: BenchColumn = {
      stylist_id: s.stylist_id, stylist_name: s.name, status: s.status,
      has_brief, has_envelope, brands_in_stock: brandsInStock(has_brief ? parsed : null, pool),
      decisions: Math.round(model.decisions),
      pieces: [], item_ids: [], brands: [], notes: '',
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
            stylistOnlyTaste(has_brief ? parsed : undefined, model),
            {
              name: s.name,
              envelope: has_envelope ? { mean: s.envelope.mean, spread: s.envelope.spread ?? [] } : null,
              weight: PERSONA_START_WEIGHT,
            } as PersonaLens,
          ]
      const looks = composeMemberVariants(taste, pool as any, hero.item_id, 1, occ, lens, history, { ownedMode: 'retail_only' })
      const look = looks[0]
      if (!look) { columns.push({ ...base, error: 'Nothing this stylist would put with it' }); continue }
      const rows = look.items.map((it: any) => dims.get(it.item_id ?? '')).filter(Boolean)
      const pieces: BenchPiece[] = look.items.map((it: any) => {
        const row = dims.get(it.item_id ?? '')
        return {
          item_id: it.item_id ?? null,
          product_name: it.product_name,
          brand: it.brand,
          image_url: row?.image_url ?? null,
          price_gbp: it.price_gbp ?? null,
          is_hero: it.item_id === hero.item_id,
          item_type: row?.item_type ?? null,
          colour_family: row?.colour_family ?? null,
          material: row?.material_primary ?? null,
        }
      })
      const scorecard = {
        ...scoreBenchColumn({
          hero,
          pieces: rows.filter((r: any) => r.item_id !== hero.item_id),
          brief: has_brief ? parsed : null,
          envelope: has_envelope ? { mean: s.envelope.mean, spread: s.envelope.spread ?? [] } : null,
          occ,
          score: look.score,
        }),
        distinct: null,
        twins: [],
      }
      columns.push({
        ...base,
        pieces,
        item_ids: pieces.map((p) => p.item_id).filter((id): id is string => !!id),
        brands: Array.from(new Set(pieces.filter((p) => !p.is_hero).map((p) => p.brand).filter(Boolean))),
        notes: look.notes ?? '',
        scorecard,
      })
      offers.push({ stylistId: s.stylist_id, items: rows.map(toFeature), itemIds: pieces.map((p) => p.item_id).filter((id): id is string => !!id) })
    } catch (err) {
      columns.push({ ...base, error: err instanceof Error ? err.message : 'Compose failed' })
    }
  }

  const done = columns.filter((c) => c.pieces.length)
  const distinct = scoreDistinctness(done.map((c) => ({ stylist_name: c.stylist_name, pieces: c.pieces })), hero.item_id)
  done.forEach((c, i) => { if (c.scorecard) { c.scorecard.distinct = distinct[i].distinct; c.scorecard.twins = distinct[i].twins } })
  const identical = done.length > 1 && done.every((c) => (c.scorecard?.twins.length ?? 0) === done.length - 1)

  // Every look shown is an offer: approval rates need both sides. Never blocks the run.
  if (opts.offers !== false) {
    for (const o of offers) {
      void recordStyleOffers([{ items: o.items, anchorItemId: hero.item_id, itemIds: o.itemIds }], 'bench', o.stylistId)
    }
  }

  return {
    hero: heroView,
    occasion_id: occasionId,
    occasion_label: occasionId ? (OCCASION_LABEL[occasionId] ?? occasionId) : null,
    member_name: member?.name ?? null,
    columns,
    identical,
    summary: {
      mean_on_brief: avg(done.map((c) => c.scorecard?.on_brief)),
      mean_occasion: avg(done.map((c) => c.scorecard?.occasion)),
      mean_distinct: avg(done.map((c) => c.scorecard?.distinct)),
      house_default_count: columns.filter((c) => !c.has_brief && !c.has_envelope).length,
    },
  }
}

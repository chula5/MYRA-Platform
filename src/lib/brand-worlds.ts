// HER STYLE WORLDS — more brands, without a piece she would dislike or can't afford.
//
// The picker's groups (onboarding/brand-groups.ts, plus brands MYRA has filed
// into a group since: brand.picker_group) are her style worlds. Rules agreed
// with Chloe, 2026-11-19:
//
//   • a brand she pressed ✕ / unticked (brands_never), wears-but-never-wants
//     (brands_input_only) or took out (hidden affinity) is a HARD NO, never shown;
//   • a brand she left unticked in a world she loved other brands in is a
//     QUIET MAYBE: Browse only, after her own brands, exact matches only,
//     inside her per-category price bands and within one price bracket of the
//     brands she loves in that world — never her feed, never a composed look;
//   • a brand in a world she ignored entirely is left out;
//   • a maybe-brand whose pieces she has scrolled past a few times drops out
//     (skip_count ≥ MAYBE_IGNORES with no positive). A save promotes it into
//     her graph (applyBrandSignals +0.05 lifts it over the baseline).
//
// And the other direction: when the daily picker placement files a NEW brand
// into a world, a member who took that whole world (every brand in it loved or
// never) gets it added to her brands, if its price bracket fits hers there.
//
// Pure helpers first (unit tested in __tests__/brand-worlds.test.ts), then the
// loaders. No session is read here: callers resolve the member.

import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'
import { brandFamily, brandBracket, type Bracket } from '@/lib/brand-families'
import { brandKey } from '@/lib/brand-affinity'

/** Scrolled past this many times with no save, click or yes: the maybe drops out. */
export const MAYBE_IGNORES = 3
/** At most this many maybe answers follow her own in one search. */
export const MAYBE_SHOWN = 8

export interface WorldBrand {
  brand_id: string
  name: string
  aliases?: string[] | null
  /** brand.picker_group — set by lib/picker-placement for brands the groups don't name. */
  picker_group?: string | null
  status?: string | null
  /** Estimated from its pieces when the brand has no authored bracket. */
  bracket?: Bracket | null
}

export interface MaybeBrand { group: string; like: string }

/** The world a brand row sits in: the authored groups first, then where placement filed it. */
export function worldOf(b: Pick<WorldBrand, 'name' | 'aliases' | 'picker_group'>): string | null {
  const authored = brandFamily({ name: b.name, aliases: b.aliases ?? [] })
  if (authored) return authored
  const g = (b.picker_group ?? '').trim()
  return g && g !== 'none' ? g : null
}

export function bracketOf(b: Pick<WorldBrand, 'name' | 'aliases' | 'bracket'>): Bracket | null {
  return brandBracket({ name: b.name, aliases: b.aliases ?? [] }) ?? b.bracket ?? null
}

/**
 * A brand's bracket read off its pieces' median price, for a brand the
 * authored table does not hold. Calibrated 2026-11-19 on clothing medians:
 * Jigsaw £111 / Sister Jane £165 (1), ME+EM £250 (2), Isabel Marant £386 /
 * Joseph £475 / Ulla Johnson £590 (3), Dries Van Noten £849 / The Row £1457 (4).
 */
export function bracketFromMedian(median: number | null | undefined): Bracket | null {
  if (median == null || !Number.isFinite(median) || median <= 0) return null
  if (median <= 180) return 1
  if (median <= 320) return 2
  if (median <= 650) return 3
  return 4
}

/** Within one bracket of a bracket she loves in that world? Unknown on either side is not judged. */
export function bracketFits(candidate: Bracket | null, hers: Bracket[]): boolean {
  if (candidate == null || !hers.length) return true
  return hers.some((h) => Math.abs(h - candidate) <= 1)
}

/**
 * Her quiet maybes: brand_id → the world and the loved brand it sits beside
 * ("From a brand like Rixo"). `loved` is her named brands' ids in her order;
 * `inGraph` every brand already hers (never a maybe — it is already an answer);
 * `turnedDown` never / input-only / hidden; `ignored` scrolled past too often.
 */
export function maybeBrandsFor(input: {
  brands: WorldBrand[]
  loved: string[]
  inGraph: Set<string>
  turnedDown: Set<string>
  ignored: Set<string>
}): Map<string, MaybeBrand> {
  const byId = new Map(input.brands.map((b) => [b.brand_id, b]))
  // Her loved brands per world, in her order, with their brackets.
  const lovedIn = new Map<string, { names: string[]; brackets: Bracket[]; each: { name: string; bracket: Bracket | null }[] }>()
  const allBrackets: Bracket[] = []
  for (const id of input.loved) {
    const b = byId.get(id)
    if (!b) continue
    const w = worldOf(b)
    const br = bracketOf(b)
    if (br != null) allBrackets.push(br)
    if (!w) continue
    const e = lovedIn.get(w) ?? { names: [], brackets: [], each: [] }
    if (!e.names.includes(b.name)) { e.names.push(b.name); e.each.push({ name: b.name, bracket: br }) }
    if (br != null) e.brackets.push(br)
    lovedIn.set(w, e)
  }
  const lovedSet = new Set(input.loved)
  const out = new Map<string, MaybeBrand>()
  for (const b of input.brands) {
    if (b.status && b.status !== 'stocked') continue
    if (lovedSet.has(b.brand_id) || input.inGraph.has(b.brand_id)) continue
    if (input.turnedDown.has(b.brand_id) || input.ignored.has(b.brand_id)) continue
    const w = worldOf(b)
    const world = w ? lovedIn.get(w) : undefined
    if (!w || !world) continue // a world she ignored entirely: left out
    const hers = world.brackets.length ? world.brackets : allBrackets
    const mine = bracketOf(b)
    if (!bracketFits(mine, hers)) continue
    out.set(b.brand_id, { group: w, like: nearestLoved(world.each, mine) })
  }
  return out
}

/** The loved brand to name beside a maybe: the nearest in price, then the first in her order. */
function nearestLoved(each: { name: string; bracket: Bracket | null }[], bracket: Bracket | null): string {
  if (bracket == null) return each[0].name
  let best = each[0]
  let gap = best.bracket == null ? 9 : Math.abs(best.bracket - bracket)
  for (const e of each) {
    const g = e.bracket == null ? 9 : Math.abs(e.bracket - bracket)
    if (g < gap) { best = e; gap = g }
  }
  return best.name
}

/** Every brand name a world offers in the picker: authored names plus the brands filed into it. */
export function worldNames(group: string, filed: Pick<WorldBrand, 'name' | 'picker_group'>[] = []): string[] {
  const g = BRAND_GROUPS.find((x) => x.key === group)
  const authored = g ? [...g.brands, ...(g.more ?? [])] : []
  const seen = new Set(authored.map(brandKey))
  const extra = filed.filter((f) => f.picker_group === group && !seen.has(brandKey(f.name))).map((f) => f.name)
  return [...authored, ...extra]
}

/**
 * Did she take this whole world? Every brand the picker offers in it is one
 * she loves or said never to — and she loves at least one (a world of nevers
 * is a world she turned down, not one she took).
 */
export function tookWholeWorld(names: string[], loved: Set<string>, never: Set<string>): boolean {
  if (!names.length) return false
  let any = false
  for (const n of names) {
    const k = brandKey(n)
    if (loved.has(k)) { any = true; continue }
    if (!never.has(k)) return false
  }
  return any
}

// ── Loaders ─────────────────────────────────────────────────────────────────

let rowCache: { at: number; rows: WorldBrand[] } | null = null

/** Every brand with its world, cached a few minutes like the other brand lists. */
export async function loadWorldBrands(admin: any): Promise<WorldBrand[]> {
  if (rowCache && Date.now() - rowCache.at < 5 * 60_000) return rowCache.rows
  const { data } = await admin.from('brand').select('brand_id, name, aliases, picker_group, status').limit(3000)
  const rows: WorldBrand[] = ((data ?? []) as any[]).filter((b) => b?.name).map((b) => ({
    brand_id: String(b.brand_id),
    name: String(b.name),
    aliases: Array.isArray(b.aliases) ? b.aliases : [],
    picker_group: b.picker_group ?? null,
    status: b.status ?? null,
  }))
  rowCache = { at: Date.now(), rows }
  return rows
}

/**
 * Her quiet maybes for Browse. `graph` is her taste graph (lib/taste-graph):
 * its named ids are her loved brands, its weights what is already hers, its
 * blocked set her hard noes.
 */
export async function loadMaybeBrands(
  admin: any,
  memberId: string,
  graph: { weights: Map<string, number>; blocked: Set<string>; named?: string[] },
): Promise<Map<string, MaybeBrand>> {
  if (!graph.named?.length) return new Map()
  const [brands, { data: passed }] = await Promise.all([
    loadWorldBrands(admin),
    admin.from('user_brand_affinity')
      .select('brand_id, skip_count, positive_count')
      .eq('user_id', memberId)
      .gte('skip_count', MAYBE_IGNORES)
      .limit(1000),
  ])
  const ignored = new Set(((passed ?? []) as any[]).filter((r) => !(Number(r.positive_count) > 0)).map((r) => String(r.brand_id)))
  return maybeBrandsFor({
    brands,
    loved: graph.named,
    inGraph: new Set(graph.weights.keys()),
    turnedDown: graph.blocked,
    ignored,
  })
}

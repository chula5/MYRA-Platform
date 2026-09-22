'use server'

// THE BRANDS SHE LOVES — hers to say, not only hers to be told.
//
// Until now a member's brands were whatever Chloe entered at intake. This is
// the same list, opened up to her: what she already has, what MYRA reached for
// from it, and the ability to add to it in onboarding and at any point after
// in her settings.
//
// WHY THIS WRITES pilot_member.brands AND NOT JUST AN AFFINITY ROW.
// There are two brand stores and they do different jobs. user_brand_affinity
// is the numeric model the composer ranks with; pilot_member.brands is the
// DECLARATION — the ranked list with her reason for each — and sendDelivery
// validates every look against it, rejecting a look that contains a brand she
// never named. So writing only an affinity would let a new brand influence
// what gets composed and then fail at the moment of sending. Everything here
// goes through setMemberBrands, the same call the admin editor uses, which
// writes the declaration, retires expansions whose source brand is gone, and
// re-seeds the affinities from the result.
//
// A brand she adds goes to the END of the ranking. Rank is live signal —
// loadMemberTaste floors affinity by it — and her stylist's rank 1 should not
// be displaced by whatever she typed most recently.
//
// Every action resolves the member on the server: her session, or the member
// Chloe names from HER VIEW, which resolveClientMember honours for the admin
// only. A browser-supplied member id from anyone else resolves to nobody, so
// one client can never edit another's brands. As with her other settings, an
// edit Chloe makes from HER VIEW is saved — it is the member's real profile.

import { revalidatePath } from 'next/cache'
import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient } from '@/lib/supabase-server'
import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'
import { setMemberBrands } from '@/app/admin/private-stylist/actions'
import { isFastFashion, type RankedBrand } from '@/lib/pilot-stylist'
import {
  AFFINITY_FLOOR,
  SEED,
  brandKey,
  loadAffinities,
  loadBrandGraph,
  type BrandGraph,
} from '@/lib/brand-affinity'

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface MyBrand {
  name: string
  /** The reason on her record — Chloe's words at intake, where there are any. */
  why: string | null
  /** False when MYRA has no brand row for it: it cannot reach her looks yet. */
  stocked: boolean
}

export interface MyBrandsView {
  /** True when Chloe is looking at this as a member from HER VIEW. */
  test: boolean
  /** Her ranked brands, best first. The list she is being asked about. */
  favourites: MyBrand[]
  /** Brands she wears but has asked never to be sent — the Zara rule. */
  inputOnly: string[]
  /** What MYRA reached for from her brands, strongest first, with the reason. */
  suggested: { name: string; trace: string | null }[]
  /** Names she asked for that MYRA has no brand for yet. */
  requested: string[]
  /** The picker: curated aesthetics, each brand flagged if it is already hers. */
  groups: {
    key: string
    name: string
    blurb: string
    brands: { name: string; stocked: boolean; mine: boolean }[]
  }[]
  /** False until 0032_brand_affinity.sql has been run. */
  available: boolean
}

export interface BrandSaveResult {
  /** She named something MYRA has no brand row for. Noted, not lost. */
  requested?: string
  /** She already had it. */
  already?: string
  /** Fast fashion: kept as taste signal, but it can never be sent to her. */
  signalOnly?: string
  error?: string
}

/** She is shown MYRA's strongest reads of her, not the catalogue. */
const SUGGESTED_SHOWN = 18
const MAX_FAVOURITES = 60

// ── Reads ───────────────────────────────────────────────────────────────────

export async function loadMyBrands(asMemberId?: string): Promise<MyBrandsView | null> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return null

  const admin = createAdminClient() as any
  const { data: member } = await admin
    .from('pilot_member')
    .select('brands, brands_input_only')
    .eq('member_id', me.memberId)
    .maybeSingle()

  const declared = ((member?.brands ?? []) as RankedBrand[])
    .filter((b) => b?.name)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  const inputOnly = ((member?.brands_input_only ?? []) as string[]).filter(Boolean)

  const base: MyBrandsView = {
    test: me.test,
    favourites: declared.map((b) => ({ name: b.name, why: b.inferred_why ?? null, stocked: false })),
    inputOnly,
    suggested: [],
    requested: [],
    groups: BRAND_GROUPS.map((g) => ({
      key: g.key, name: g.name, blurb: g.blurb,
      brands: g.brands.map((name) => ({ name, stocked: false, mine: false })),
    })),
    available: false,
  }

  try {
    const [graph, affinities, { data: requests }] = await Promise.all([
      loadBrandGraph(admin),
      loadAffinities(admin, me.memberId),
      admin.from('unmatched_brand_log')
        .select('raw_name, created_at')
        .eq('user_id', me.memberId)
        .is('handled_at', null)
        .order('created_at', { ascending: false })
        .limit(40),
    ])
    // No brand table at all means 0032 has not been run. An empty affinity map
    // is a different thing — a member nobody has seeded yet — and must not be
    // reported as a missing migration.
    if (!graph.brands.length) return base

    const stocked = stockedKeys(graph)
    const mineKeys = new Set(declared.map((b) => brandKey(b.name)))

    // MYRA's read of her: what it expanded to, minus the baseline, which is
    // simply every brand it stocks. Showing baseline as a suggestion would
    // tell her MYRA thinks she likes everything.
    const suggested = Array.from(affinities.values())
      .filter((r) => !r.hidden && r.source !== 'onboarded' && Number(r.affinity) > SEED.baseline)
      .map((r) => ({ brand: graph.byId.get(r.brand_id), row: r }))
      .filter((x) => x.brand && !mineKeys.has(brandKey(x.brand!.name)))
      .sort((a, b) => Number(b.row.affinity) - Number(a.row.affinity))
      .slice(0, SUGGESTED_SHOWN)
      .map((x) => ({
        name: x.brand!.name,
        trace: x.row.expansion_trace && x.row.expansion_trace !== 'baseline' ? x.row.expansion_trace : null,
      }))

    return {
      ...base,
      favourites: declared.map((b) => ({
        name: b.name,
        why: b.inferred_why ?? null,
        stocked: stocked.has(brandKey(b.name)),
      })),
      suggested,
      requested: dedupeNames(((requests ?? []) as any[]).map((r) => String(r.raw_name))),
      groups: buildGroups(stocked, mineKeys),
      available: true,
    }
  } catch (err) {
    console.error('[loadMyBrands]', err)
    return base
  }
}

/** Every name and alias MYRA can actually shop, folded to the same key the
 *  recommender matches on — so "Sessun" finds "Sessùn" here exactly as it does
 *  at compose time, and the picker never disagrees with the composer. */
function stockedKeys(graph: BrandGraph): Set<string> {
  const keys = new Set<string>()
  for (const b of graph.brands) {
    if (b.status !== 'stocked') continue
    keys.add(brandKey(b.name))
    for (const a of b.aliases) keys.add(brandKey(a))
  }
  return keys
}

/** The picker. A brand MYRA does not stock is still offered — naming it makes
 *  a request Chloe sees — but it is marked, so the list never implies MYRA can
 *  shop something it cannot. */
function buildGroups(stocked: Set<string>, mine: Set<string>): MyBrandsView['groups'] {
  return BRAND_GROUPS.map((g) => ({
    key: g.key,
    name: g.name,
    blurb: g.blurb,
    brands: g.brands.map((name) => ({
      name,
      stocked: stocked.has(brandKey(name)),
      mine: mine.has(brandKey(name)),
    })),
  }))
}

/** Asking twice is one request, not two. */
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const key = brandKey(n)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(n.trim())
  }
  return out
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Her record as it stands, for a read-modify-write. */
async function currentLists(memberId: string): Promise<{ brands: RankedBrand[]; inputOnly: string[] }> {
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('pilot_member')
    .select('brands, brands_input_only')
    .eq('member_id', memberId)
    .maybeSingle()
  return {
    brands: ((data?.brands ?? []) as RankedBrand[])
      .filter((b) => b?.name)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    inputOnly: ((data?.brands_input_only ?? []) as string[]).filter(Boolean),
  }
}

/**
 * setMemberBrands renumbers ranks from the array order, writes both columns,
 * retires expansions whose source brand is no longer named, and re-seeds the
 * affinities. It revalidates the admin page itself; her own pages are ours.
 *
 * The member id is passed in every time rather than held anywhere: a module
 * -level variable on the server is shared by every request in the process, and
 * two clients saving at once would write each other's brands.
 */
async function commitFor(
  memberId: string,
  brands: RankedBrand[],
  inputOnly: string[],
): Promise<{ error?: string; unmatched?: string[] }> {
  const result = await setMemberBrands(memberId, brands, inputOnly)
  revalidatePath('/me/profile')
  revalidatePath('/me')
  return result
}

export async function addMyBrand(rawName: string, asMemberId?: string): Promise<BrandSaveResult> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }

  const name = String(rawName ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
  if (!name) return { error: 'Type a brand name first' }
  if (!brandKey(name)) return { error: 'That doesn’t look like a brand name' }

  try {
    const { brands, inputOnly } = await currentLists(me.memberId)
    const key = brandKey(name)
    if (brands.some((b) => brandKey(b.name) === key)) return { already: name }

    if (brands.length >= MAX_FAVOURITES) {
      return { error: `That is as many brands as MYRA can hold for you — remove one first` }
    }

    // Fast fashion is taste signal, never a recommendation: a look containing
    // it fails validateDelivery outright. Naming it here files it where it
    // belongs rather than refusing her, so MYRA still learns from it.
    if (isFastFashion(name)) {
      if (inputOnly.some((n) => brandKey(n) === key)) return { already: name }
      const r = await commitFor(me.memberId, brands, [...inputOnly, name])
      return r.error ? { error: r.error } : { signalOnly: name }
    }

    const nextInputOnly = inputOnly.filter((n) => brandKey(n) !== key)
    const next: RankedBrand[] = [...brands, { name, rank: brands.length + 1 }]

    // If she had previously taken this brand out, the affinity row is still
    // hidden and floored. Naming it again is the later, truer word — clear it
    // before re-seeding, which writes the affinity but not the hidden flag.
    await unhide(me.memberId, name)

    const r = await commitFor(me.memberId, next, nextInputOnly)
    if (r.error) return { error: r.error }
    if (r.unmatched?.some((u) => brandKey(u) === key)) return { requested: name }
    return {}
  } catch (err) {
    console.error('[addMyBrand]', err)
    return { error: 'Could not add that brand — try again' }
  }
}

export async function removeMyBrand(rawName: string, asMemberId?: string): Promise<BrandSaveResult> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const key = brandKey(String(rawName ?? ''))
  if (!key) return { error: 'No brand' }

  try {
    const { brands, inputOnly } = await currentLists(me.memberId)
    const next = brands.filter((b) => brandKey(b.name) !== key)
    const nextInputOnly = inputOnly.filter((n) => brandKey(n) !== key)
    if (next.length === brands.length && nextInputOnly.length === inputOnly.length) return {}

    const r = await commitFor(me.memberId, next, nextInputOnly)
    if (r.error) return { error: r.error }

    // Taking a brand out is a judgement, so the affinity row is hidden and
    // floored rather than deleted — the same rule the admin follows. Without
    // this the brand would keep its 1.0 from the last seeding and go on being
    // ranked for her after she has said it is not her.
    await hide(me.memberId, rawName, me.test)
    return {}
  } catch (err) {
    console.error('[removeMyBrand]', err)
    return { error: 'Could not remove that brand — try again' }
  }
}

/**
 * Move a brand between "send me this" and "I wear it, don't send it".
 * The second list is the Zara rule: real taste signal, never an output.
 */
export async function setMyBrandInputOnly(
  rawName: string,
  inputOnlyWanted: boolean,
  asMemberId?: string,
): Promise<BrandSaveResult> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const name = String(rawName ?? '').trim()
  const key = brandKey(name)
  if (!key) return { error: 'No brand' }

  try {
    const { brands, inputOnly } = await currentLists(me.memberId)
    if (inputOnlyWanted) {
      if (inputOnly.some((n) => brandKey(n) === key)) return {}
      const r = await commitFor(
        me.memberId,
        brands.filter((b) => brandKey(b.name) !== key),
        [...inputOnly, name],
      )
      return r.error ? { error: r.error } : {}
    }
    // Moving it back to favourites is refused for fast fashion, which cannot
    // be recommended at all — saying yes here would only fail at send.
    if (isFastFashion(name)) {
      return { error: `MYRA can learn from ${name}, but can’t send it to you` }
    }
    if (brands.some((b) => brandKey(b.name) === key)) return {}
    const r = await commitFor(
      me.memberId,
      [...brands, { name, rank: brands.length + 1 }],
      inputOnly.filter((n) => brandKey(n) !== key),
    )
    return r.error ? { error: r.error } : {}
  } catch (err) {
    console.error('[setMyBrandInputOnly]', err)
    return { error: 'Could not move that brand — try again' }
  }
}

// ── Affinity side-effects ───────────────────────────────────────────────────

async function hide(memberId: string, name: string, test: boolean): Promise<void> {
  try {
    const admin = createAdminClient() as any
    const graph = await loadBrandGraph(admin)
    const key = brandKey(name)
    const brand = graph.brands.find(
      (b) => brandKey(b.name) === key || b.aliases.some((a) => brandKey(a) === key),
    )
    if (!brand) return
    await admin.from('user_brand_affinity')
      .update({ hidden: true, affinity: AFFINITY_FLOOR, updated_at: new Date().toISOString() })
      .eq('user_id', memberId)
      .eq('brand_id', brand.brand_id)
    await admin.from('brand_affinity_event').insert({
      user_id: memberId, brand_id: brand.brand_id, new_value: AFFINITY_FLOOR, source: 'hidden',
      reason: test ? 'removed by her stylist in her settings' : 'removed by her in the app',
    })
  } catch { /* the declaration is already written; this is the tidy-up */ }
}

async function unhide(memberId: string, name: string): Promise<void> {
  try {
    const admin = createAdminClient() as any
    const graph = await loadBrandGraph(admin)
    const key = brandKey(name)
    const brand = graph.brands.find(
      (b) => brandKey(b.name) === key || b.aliases.some((a) => brandKey(a) === key),
    )
    if (!brand) return
    await admin.from('user_brand_affinity')
      .update({ hidden: false })
      .eq('user_id', memberId)
      .eq('brand_id', brand.brand_id)
  } catch { /* re-seeding will still raise the affinity */ }
}

// HER BRAND LISTS, WRITTEN — the server-side core of me/brand-actions.
//
// NOT a 'use server' module, on purpose: every export of a 'use server' file is
// callable by anyone from the browser, and these take a member id. The member
// actions (me/brand-actions) resolve her on the server first and call in here;
// the picker-brands cron calls addBrandsForMember for members who took a whole
// style world (lib/brand-worlds), through the very same path a tap takes.
// See me/brand-actions for why brands are written through setMemberBrands.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { setMemberBrands } from '@/app/admin/private-stylist/actions'
import { isFastFashion, type RankedBrand } from '@/lib/pilot-stylist'
import { AFFINITY_FLOOR, brandKey, loadBrandGraph } from '@/lib/brand-affinity'

export interface BrandSaveResult {
  /** She named something MYRA has no brand row for. Noted, not lost. */
  requested?: string
  /** She already had it. */
  already?: string
  /** Fast fashion: kept as taste signal, but it can never be sent to her. */
  signalOnly?: string
  error?: string
}

/** Clean a list of typed names: trimmed, keyed, deduped, empties dropped. */
export function cleanNames(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw ?? []) {
    const name = String(r ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
    const key = brandKey(name)
    if (!name || !key || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Her record as it stands, for a read-modify-write. */
export async function currentLists(memberId: string): Promise<{ brands: RankedBrand[]; inputOnly: string[]; never: string[] }> {
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('pilot_member')
    .select('brands, brands_input_only, brands_never')
    .eq('member_id', memberId)
    .maybeSingle()
  return {
    brands: ((data?.brands ?? []) as RankedBrand[])
      .filter((b) => b?.name)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    inputOnly: ((data?.brands_input_only ?? []) as string[]).filter(Boolean),
    never: ((data?.brands_never ?? []) as string[]).filter(Boolean),
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
export async function commitFor(
  memberId: string,
  brands: RankedBrand[],
  inputOnly: string[],
): Promise<{ error?: string; unmatched?: string[] }> {
  const result = await setMemberBrands(memberId, brands, inputOnly)
  revalidatePath('/me/profile')
  revalidatePath('/me')
  return result
}

/** The not-for-me list is its own column and never goes near the seeder. */
export async function writeNever(memberId: string, never: string[]): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('pilot_member')
    .update({ brands_never: cleanNames(never), updated_at: new Date().toISOString() })
    .eq('member_id', memberId)
  if (error) return { error: error.message }
  revalidatePath('/me/profile')
  revalidatePath('/me')
  return {}
}

export async function addBrandsForMember(me: { memberId: string; test: boolean }, rawNames: string[]): Promise<BrandSaveResult> {
  const names = cleanNames(rawNames)
  if (!names.length) return { error: 'Type a brand name first' }

  try {
    const { brands, inputOnly, never } = await currentLists(me.memberId)
    const had = new Set(brands.map((b) => brandKey(b.name)))
    const hadInputOnly = new Set(inputOnly.map((n) => brandKey(n)))

    const toLove = names.filter((n) => !isFastFashion(n) && !had.has(brandKey(n)))
    const toSignal = names.filter((n) => isFastFashion(n) && !hadInputOnly.has(brandKey(n)))
    if (!toLove.length && !toSignal.length) return { already: names[0] }

    const keys = new Set(names.map((n) => brandKey(n)))
    const nextNever = never.filter((n) => !keys.has(brandKey(n)))
    if (nextNever.length !== never.length) {
      const w = await writeNever(me.memberId, nextNever)
      if (w.error) return { error: w.error }
    }

    const next: RankedBrand[] = [...brands, ...toLove.map((name, i) => ({ name, rank: brands.length + i + 1 }))]
    const nextInputOnly = [...inputOnly.filter((n) => !keys.has(brandKey(n)) || isFastFashion(n)), ...toSignal]

    // If she had previously taken a brand out, its affinity row is still
    // hidden and floored. Naming it again clears that before re-seeding, which
    // writes the affinity but not the hidden flag.
    await setHidden(me.memberId, [...toLove, ...toSignal], false, me.test)

    const r = await commitFor(me.memberId, next, nextInputOnly)
    if (r.error) return { error: r.error }
    const asked = (r.unmatched ?? []).filter((u) => keys.has(brandKey(u)))
    if (asked.length) return { requested: asked.join(', ') }
    if (!toLove.length && toSignal.length) return { signalOnly: toSignal.join(', ') }
    return {}
  } catch (err) {
    console.error('[addMyBrands]', err)
    return { error: 'Could not add that brand — try again' }
  }
}

// ── Affinity side-effects ───────────────────────────────────────────────────

/**
 * Hide (floor) or un-hide the affinity rows for these names. Hidden is the one
 * hard filter the recommender applies, so this is what actually keeps a
 * removed or not-for-me brand out of her looks between seedings. Best-effort:
 * the declaration is already written by the time this runs.
 */
export async function setHidden(memberId: string, names: string[], hidden: boolean, test: boolean): Promise<void> {
  if (!names.length) return
  try {
    const admin = createAdminClient() as any
    const graph = await loadBrandGraph(admin)
    const ids: string[] = []
    for (const name of names) {
      const key = brandKey(name)
      const brand = graph.brands.find(
        (b) => brandKey(b.name) === key || b.aliases.some((a) => brandKey(a) === key),
      )
      if (brand) ids.push(brand.brand_id)
    }
    if (!ids.length) return
    if (hidden) {
      await admin.from('user_brand_affinity')
        .update({ hidden: true, affinity: AFFINITY_FLOOR, updated_at: new Date().toISOString() })
        .eq('user_id', memberId)
        .in('brand_id', ids)
      await admin.from('brand_affinity_event').insert(ids.map((brand_id) => ({
        user_id: memberId, brand_id, new_value: AFFINITY_FLOOR, source: 'hidden',
        reason: test ? 'removed by her stylist in her settings' : 'removed by her in the app',
      })))
    } else {
      await admin.from('user_brand_affinity')
        .update({ hidden: false })
        .eq('user_id', memberId)
        .in('brand_id', ids)
    }
  } catch { /* the declaration is already written; this is the tidy-up */ }
}

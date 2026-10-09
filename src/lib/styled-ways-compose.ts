// WAYS TO WEAR IT — building them.
//
// One piece, a few lives: looks are composed in her own occasions (the ones
// she dresses for most, first), the way the Mirror's panel does, then every
// candidate goes through MYRA's eye. A look that passes is KEPT the moment it
// passes (lib/styled-ways) and handed to `onLook`, so a page polling the
// memory sees the first way at ~6s rather than all three at ~12s. Nothing
// unchecked is ever kept or shown.
//
// Server use only. This is what a styled_way_job runs; it is also what a tap
// runs when it cannot wait for the queue.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { composeMemberVariants, tooSimilarVariant } from '@/lib/pilot-composer'
import { slotForItemType } from '@/lib/composer'
import { judgeLooksForMemberEach } from '@/lib/look-check'
import { whyThisSuitsHer } from '@/lib/look-why'
import { readStylePrefs, effectiveWeights, normalise, lookTasteVector } from '@/lib/pilot-stylist'
import { occasionsForMember, OCCASION_LABEL } from '@/lib/client-occasions'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import {
  loadComposableLibrary, loadMemberTaste, loadPersonaLens, loadComposeHistory,
} from '@/app/admin/private-stylist/actions'
import { getStyledWays, keptItemIds, saveStyledWays, type StyledWayLook, type WayMode } from '@/lib/styled-ways'
import { WAYS, signatureOf, type WaySource } from '@/lib/styled-ways-core'

const MIN_WARDROBE = 6
/** Spares judged beyond what is wanted, so a failed check still leaves three. */
const SPARES = 2
const OCCASIONS_PER_ASK = 2
const PER_OCCASION = 3

export interface ComposeWaysResult {
  composed: number
  judged: number
  passed: number
  saved: StyledWayLook[]
  firstLookMs: number | null
  totalMs: number
  error?: string
}

export async function composeStyledWays(
  memberId: string,
  heroId: string,
  opts: {
    mode?: WayMode
    shuffle?: number
    source?: WaySource
    want?: number
    onLook?: (look: StyledWayLook) => void | Promise<void>
    admin?: any
  } = {},
): Promise<ComposeWaysResult> {
  const t0 = Date.now()
  const admin = opts.admin ?? (createAdminClient() as any)
  const mode: WayMode = opts.mode ?? 'blend'
  const want = opts.want ?? WAYS
  const source: WaySource = opts.source ?? 'tap'
  const fail = (error: string): ComposeWaysResult =>
    ({ composed: 0, judged: 0, passed: 0, saved: [], firstLookMs: null, totalMs: Date.now() - t0, error })

  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle()
  if (!member) return fail('Member not found')
  const { data: hero } = await admin.from('item').select('*, brand(*)').eq('item_id', heroId).neq('status', 'archived').maybeSingle()
  if (!hero) return fail('MYRA cannot find that piece any more')
  if (!hero.image_url) return fail('No picture of this piece to work from')

  const library = await loadComposableLibrary(member)
  const inLibrary = library.some((i) => i.item_id === heroId)
  let pool: any[]
  if (mode === 'wardrobe') {
    const owned = library.filter((i) => isOwnedItem(i as any))
    if (owned.length < MIN_WARDROBE) return fail('Import your wardrobe in MYRA to style with it')
    pool = inLibrary && isOwnedItem(hero) ? owned : [...owned, hero]
  } else if (mode === 'inspiration') {
    const retail = library.filter((i) => !isOwnedItem(i as any))
    pool = inLibrary && !isOwnedItem(hero) ? retail : [...retail, hero]
  } else {
    pool = inLibrary ? library : [...library, hero]
  }

  const [taste, lens, history, kept] = await Promise.all([
    loadMemberTaste(admin, member),
    loadPersonaLens(admin, memberId),
    loadComposeHistory(admin, memberId),
    keptItemIds(admin, memberId, heroId, mode),
  ])
  const ownedMode = mode === 'inspiration' ? 'retail_only' : 'blend'
  const shuffle = (opts.shuffle ?? 0) + kept.length

  // Her two most dressed-for occasions — a piece worth having is one she can
  // see where she would wear — each composing three from its own rotation.
  // Composing costs ~1.6s a call over her whole library (measured 2026-10-08),
  // so this is two calls, not one per occasion she has.
  const occasionIds = occasionsForMember(member.occasions).filter((id) => id !== 'kids').slice(0, OCCASIONS_PER_ASK)
  const perOccasion: { id: string | null; label: string; look: any }[] = []
  ;(occasionIds.length ? occasionIds : [null]).forEach((id, oi) => {
    const occ = id
      ? { id: id as any, vector: lookTasteVector(normalise(effectiveWeights(member.room_weights, id as any, member.work_dress_code))), climate: null }
      : undefined
    for (const look of composeMemberVariants(taste, pool as any, heroId, PER_OCCASION, occ, lens, history, { ownedMode, shuffle: shuffle + oi })) {
      perOccasion.push({ id, label: id ? (OCCASION_LABEL[id] ?? id) : '', look })
    }
  })
  // Top up from no occasion at all when hers gave too few — a small wardrobe
  // or a narrow pool must not answer with one look.
  if (perOccasion.length < want + SPARES) {
    for (const look of composeMemberVariants(taste, pool as any, heroId, want + SPARES, undefined, lens, history, { ownedMode, shuffle: shuffle + 11 })) {
      perOccasion.push({ id: null, label: '', look })
    }
  }

  // Never a look she already has around this piece, nor a near-twin of one,
  // nor two near-twins of each other across occasions.
  const keptSigs = new Set(kept.map((ids) => [...ids].sort().join('|')))
  const dimsAll = new Map<string, any>((pool as any[]).map((i) => [i.item_id, i]))
  const idsOfLook = (l: any): (string | null | undefined)[] => (l.items as any[]).map((x) => x.item_id)
  const finishOf = (l: any) => new Set(
    idsOfLook(l).filter((id): id is string => {
      if (!id || id === heroId) return false
      const slot = slotForItemType(dimsAll.get(id)?.item_type)
      return slot === 'bag' || slot === 'jewellery'
    }),
  )
  const chosen: typeof perOccasion = []
  const takenOcc = new Set<string>()
  const takenSig = new Set<string>()
  const okWith = (cand: any, strict: boolean) => {
    const sig = signatureOf(cand.items)
    if (takenSig.has(sig) || keptSigs.has(sig)) return false
    if (kept.some((ids) => tooSimilarVariant(idsOfLook(cand), ids, heroId))) return false
    if (chosen.some((c) => tooSimilarVariant(idsOfLook(cand), idsOfLook(c.look), heroId))) return false
    if (strict) {
      const f = finishOf(cand)
      if (chosen.some((c) => Array.from(finishOf(c.look)).some((id) => f.has(id)))) return false
    }
    return true
  }
  const take = (p: typeof perOccasion[number]) => { takenSig.add(signatureOf(p.look.items)); chosen.push(p) }
  // One look per occasion first, finished differently; then loosen.
  for (const p of perOccasion) {
    if (chosen.length >= want + SPARES) break
    const occ = p.id ?? ''
    if (takenOcc.has(occ)) continue
    if (okWith(p.look, true)) { take(p); takenOcc.add(occ) }
  }
  for (const p of perOccasion) { if (chosen.length >= want + SPARES) break; if (!chosen.includes(p) && okWith(p.look, false)) take(p) }

  if (!chosen.length) {
    return fail(mode === 'wardrobe'
      ? 'Nothing in your wardrobe goes with this piece yet'
      : kept.length ? 'MYRA has shown you every way it can find for this piece right now' : 'Nothing goes with this piece in your size right now')
  }

  const prefs = readStylePrefs(member)
  const withImages = (items: any[]) => items.map((it) => ({ ...it, image_url: it.image_url ?? dimsAll.get(it.item_id ?? '')?.image_url ?? null }))
  const whyOf = (items: any[]) => whyThisSuitsHer(items.map((it) => ({ ...(dimsAll.get(it.item_id ?? '') ?? {}), product_name: it.product_name, owned: !!it.owned })), prefs)

  // MYRA's eye on every candidate, in parallel; each that passes is kept at
  // once. A synchronous counter decides who may still be kept, so parallel
  // verdicts cannot save a fourth.
  let claimed = 0
  let passed = 0
  let firstLookMs: number | null = null
  const saved: StyledWayLook[] = []
  // The hero's own size never vetoes a way: she chose it — it may be hers
  // already, or low in stock — and the question is what to wear WITH it. A
  // supporting piece confirmed not in her size still fails the look.
  const supportOutOfSize = (j: { sizes: Record<string, { verdict: string }> }) =>
    Object.entries(j.sizes).some(([id, sz]) => id !== heroId && sz.verdict === 'not_in_size')
  await judgeLooksForMemberEach(admin, memberId, chosen.map((c) => c.look), 'unknown', async (i, judged) => {
    const ok = judged.check?.verdict !== 'clashes' && !supportOutOfSize(judged)
    if (!ok) return
    passed++
    if (claimed >= want) return
    claimed++
    const c = chosen[i]
    const rows = await saveStyledWays(admin, memberId, heroId, mode, [{
      items: withImages(c.look.items),
      why: whyOf(c.look.items),
      verdict: judged.check?.verdict === 'works' ? 'works' : 'borderline',
      confidence: judged.check?.confidence ?? null,
      occasion_id: c.id,
      occasion_label: c.label || null,
    }], source)
    if (!rows.length) return
    if (firstLookMs == null) firstLookMs = Date.now() - t0
    saved.push(rows[0])
    if (opts.onLook) await opts.onLook(rows[0])
  })

  return {
    composed: perOccasion.length,
    judged: chosen.length,
    passed,
    saved,
    firstLookMs,
    totalMs: Date.now() - t0,
    ...(saved.length ? {} : { error: 'Nothing passed the check for this piece right now' }),
  }
}

/** What is kept now — the read every surface makes before it asks for work. */
export async function waysFor(memberId: string, heroId: string, mode: WayMode = 'blend', admin?: any): Promise<StyledWayLook[]> {
  return getStyledWays(admin ?? (createAdminClient() as any), memberId, heroId, mode)
}

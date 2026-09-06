'use server'

// LEARNING ATTRIBUTION — reading and moving lessons between layers.
//
// The harness is only worth building if what it learns from one client makes
// the NEXT client better without making her a copy of the first. That needs
// three things this file provides: signals captured with a scope, a promotion
// pass that widens a scope only on evidence, and views that say plainly
// whether anything is compounding.
//
// The House Style Constitution belongs to the Chloe stylist, not the global
// layer. Every Chloe client inherits it in full; another stylist has their own.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import {
  gatherPatterns, promotions, attribution, stylistFit, transferSeries,
  predictedCleanRate, SCOPE_LABEL,
  type Scope, type Signal, type ClientRun, type Attribution, type StylistFit,
  type TransferPoint,
} from '@/lib/learning-scope'

const PATH = '/admin/private-stylist'

// A feedback row is a rejection signal when it names the piece that went out.
const rejectedId = (r: any): string | null =>
  r.action === 'swap' ? (r.item_out ?? null)
    : r.action === 'remove' ? (r.item_out ?? r.item_in ?? null)
      : null

async function itemsById(admin: any, ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  const all = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < all.length; i += 100) {
    const { data } = await admin.from('item')
      .select('item_id, item_type, colour_family, material_category, material_primary, brand_id, brand:brand_id(name)')
      .in('item_id', all.slice(i, i + 100))
    for (const r of data ?? []) out.set(r.item_id, r)
  }
  return out
}

/** Every scoped signal for a stylist's clients, ready for the pure layer. */
async function loadSignals(admin: any, opts: { memberId?: string } = {}): Promise<Signal[]> {
  let q = admin.from('pilot_look_feedback').select('*').limit(10000)
  if (opts.memberId) q = q.eq('member_id', opts.memberId)
  const { data: rows } = await q
  if (!rows?.length) return []

  const { data: members } = await admin
    .from('pilot_member').select('member_id, stylist_id, style_profile_id')
  const byMember = new Map((members ?? []).map((m: any) => [m.member_id, m]))

  const { data: deliveries } = await admin.from('pilot_delivery').select('delivery_id, occasion')
  const occByDelivery = new Map((deliveries ?? []).map((d: any) => [d.delivery_id, d.occasion]))

  const items = await itemsById(admin, (rows as any[]).map((r) => rejectedId(r) ?? r.item_in).filter(Boolean))

  return (rows as any[]).map((r) => {
    const out = rejectedId(r)
    const id = out ?? r.item_in
    const m: any = byMember.get(r.member_id)
    const it = id ? items.get(id) : null
    return {
      member_id: r.member_id,
      profile_id: m?.style_profile_id ?? null,
      stylist_id: m?.stylist_id ?? null,
      action: out ? (r.action === 'swap' ? 'swap' : 'remove') : 'liked',
      occasion: (occByDelivery.get(r.delivery_id) as string | undefined) ?? null,
      item: it ? {
        item_type: it.item_type, colour_family: it.colour_family,
        material_category: it.material_category, material_primary: it.material_primary,
        brand_id: it.brand_id, brand_name: it.brand?.name ?? null,
      } : null,
      scope: (r.scope ?? 'client') as Scope,
      scope_source: r.scope_source ?? 'auto',
      created_at: r.created_at,
    } satisfies Signal
  })
}

// ── Capture ─────────────────────────────────────────────────────────────────

/**
 * Tag a decision's scope by hand, from the review UI.
 *
 * "Just her" / "this style" / "Chloe's rule" / "engine" — an explicit answer
 * beats waiting for the promotion rules to accumulate evidence, and it is the
 * only way a one-off insight ever reaches the right layer.
 */
export async function tagSignalScope(
  feedbackId: string,
  scope: Scope,
): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('pilot_look_feedback')
    .update({ scope, scope_source: 'manual' }).eq('feedback_id', feedbackId)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

/** Every decision on one look, tagged at once — one tap after a swap. */
export async function tagLookScope(lookId: string, scope: Scope): Promise<{ tagged: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('pilot_look_feedback')
    .update({ scope, scope_source: 'manual' }).eq('look_id', lookId).select('feedback_id')
  if (error) return { tagged: 0, error: error.message }
  revalidatePath(PATH)
  return { tagged: (data ?? []).length }
}

// ── Promotion pass ──────────────────────────────────────────────────────────

export interface PromotionRun {
  promoted: number
  toStyle: number
  toStylist: number
  details: string[]
  error?: string
}

/**
 * Widen the scope of patterns that have earned it.
 *
 * Idempotent: a rule already recorded is refreshed with its new counts rather
 * than duplicated, so this is safe to run on every review.
 *
 * NOTE ON THE VISION CHECK: promotion to style scope is specified to require
 * the pattern to be consistent with the profile's reference images. That check
 * is not applied here yet — the moodboard comparison needs the vision pass,
 * which is currently out of API credit. Rules land as `source: 'auto'` and the
 * attribution view shows them, so nothing is hidden; but a style rule at this
 * moment rests on recurrence alone.
 */
export async function runPromotionPass(): Promise<PromotionRun> {
  const admin = createAdminClient() as any
  try {
    const signals = await loadSignals(admin)
    const found = promotions(gatherPatterns(signals))
    const details: string[] = []
    let toStyle = 0, toStylist = 0

    for (const p of found) {
      const row = {
        scope: p.scope,
        stylist_id: p.stylistId,
        profile_id: p.scope === 'style' ? p.profileId : null,
        pattern_key: p.key,
        pattern_label: p.label,
        evidence: { members: p.members, reason: p.reason },
        occurrences: p.occurrences,
        member_count: p.memberCount,
        promoted_at: new Date().toISOString(),
      }
      const { error } = await admin.from('learned_rule').upsert(row, {
        onConflict: 'scope,stylist_id,profile_id,pattern_key',
      })
      if (error) {
        // The unique index uses coalesce() and PostgREST cannot name it, so
        // fall back to a read-then-write rather than losing the promotion.
        const { data: existing } = await admin.from('learned_rule').select('rule_id')
          .eq('scope', p.scope).eq('pattern_key', p.key).limit(1)
        if (existing?.length) await admin.from('learned_rule').update(row).eq('rule_id', existing[0].rule_id)
        else await admin.from('learned_rule').insert(row)
      }
      if (p.scope === 'style') toStyle++
      else toStylist++
      details.push(`${p.scope.toUpperCase()} · ${p.label} — ${p.reason}`)
    }

    revalidatePath(PATH)
    return { promoted: found.length, toStyle, toStylist, details: details.slice(0, 20) }
  } catch (err) {
    return { promoted: 0, toStyle: 0, toStylist: 0, details: [], error: err instanceof Error ? err.message : 'Promotion pass failed' }
  }
}

// ── Attribution view ────────────────────────────────────────────────────────

export interface ClientAttribution {
  attribution: Attribution
  fit: StylistFit
  scopeLabels: Record<string, string>
  /** Rules this client's history has actually produced, by layer. */
  rules: { scope: Scope; label: string; reason: string }[]
  error?: string
}

export async function loadClientAttribution(memberId: string): Promise<ClientAttribution | { error: string }> {
  const admin = createAdminClient() as any
  try {
    const signals = await loadSignals(admin, { memberId })

    // Split her edits by what the constitution said about the look. A look
    // that PASSED and was edited anyway is her overruling the stylist; a look
    // that FAILED is the composer's mistake. approved_at is the proxy for
    // passing: a look Chloe approved is one the rules were happy with.
    const { data: dels } = await admin.from('pilot_delivery').select('delivery_id').eq('member_id', memberId)
    const ids = (dels ?? []).map((d: any) => d.delivery_id)
    const { data: looks } = ids.length
      ? await admin.from('pilot_look').select('look_id, approved_at').in('delivery_id', ids)
      : { data: [] }
    const passedByLook = new Map((looks ?? []).map((l: any) => [l.look_id, !!l.approved_at]))

    const { data: rows } = await admin.from('pilot_look_feedback')
      .select('look_id, action').eq('member_id', memberId).limit(10000)
    const edits = (rows ?? [])
      .filter((r: any) => r.look_id && r.action !== 'accept')
      .map((r: any) => ({ lookId: r.look_id, constitutionPassed: passedByLook.get(r.look_id) === true }))

    const { data: ruleRows } = await admin.from('learned_rule').select('*').eq('active', true)
    const mine = (ruleRows ?? []).filter((r: any) => (r.evidence?.members ?? []).includes(memberId))

    return {
      attribution: attribution(signals),
      fit: stylistFit(edits),
      scopeLabels: SCOPE_LABEL,
      rules: mine.map((r: any) => ({ scope: r.scope, label: r.pattern_label, reason: r.evidence?.reason ?? '' })),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read attribution' }
  }
}

// ── Transfer metric ─────────────────────────────────────────────────────────

export async function loadTransferSeries(): Promise<{ points: TransferPoint[]; error?: string }> {
  const admin = createAdminClient() as any
  try {
    const { data: members } = await admin
      .from('pilot_member').select('member_id, name, stylist_id, created_at, is_synthetic')
      .order('created_at')
    const real = (members ?? []).filter((m: any) => !m.is_synthetic)
    if (!real.length) return { points: [] }

    const runs: ClientRun[] = []
    for (const m of real) {
      const { data: dels } = await admin.from('pilot_delivery').select('delivery_id').eq('member_id', m.member_id)
      const ids = (dels ?? []).map((d: any) => d.delivery_id)
      if (!ids.length) { runs.push({ memberId: m.member_id, name: m.name, stylistId: m.stylist_id, onboardedAt: m.created_at, looksClean: [] }); continue }
      const [{ data: looks }, { data: fb }] = await Promise.all([
        admin.from('pilot_look').select('look_id, approved_at, created_at').in('delivery_id', ids).order('created_at'),
        admin.from('pilot_look_feedback').select('look_id, action').eq('member_id', m.member_id).limit(10000),
      ])
      const edited = new Set((fb ?? []).filter((r: any) => r.look_id && r.action !== 'accept').map((r: any) => r.look_id))
      const decided = (looks ?? []).filter((l: any) => l.approved_at || edited.has(l.look_id))
      runs.push({
        memberId: m.member_id, name: m.name, stylistId: m.stylist_id,
        onboardedAt: m.created_at,
        looksClean: decided.map((l: any) => !edited.has(l.look_id)),
      })
    }
    return { points: transferSeries(runs) }
  } catch (err) {
    return { points: [], error: err instanceof Error ? err.message : 'Could not read the transfer series' }
  }
}

// ── New-client inheritance report ───────────────────────────────────────────

export interface InheritanceReport {
  memberName: string
  stylistName: string
  constitutionVersion: number
  styleProfile: { name: string; matched: boolean } | null
  globalLayer: { brandsCoded: number; itemsInStock: number; enginePasses: string[] }
  inheritedRules: { stylist: number; style: number; labels: string[] }
  startsEmpty: string[]
  brandReadiness: { name: string; issue: string }[]
  predicted: { predicted: number | null; lift: number; basis: string }
  baseline: { name: string; cleanRate: number | null } | null
  verdict: string
  error?: string
}

/**
 * What a new client inherits, and whether the harness is actually carrying
 * anything to her.
 *
 * The prediction is the point of it. If a new client's predicted start is not
 * meaningfully above the previous client's ACTUAL first ten, nothing is
 * transferring and that should be visible before her first delivery, not
 * discovered afterwards.
 */
export async function loadInheritanceReport(memberId: string): Promise<InheritanceReport | { error: string }> {
  const admin = createAdminClient() as any
  try {
    const { data: m } = await admin.from('pilot_member').select('*').eq('member_id', memberId).single()
    if (!m) return { error: 'Member not found' }

    const { data: stylist } = m.stylist_id
      ? await admin.from('stylist').select('name, constitution_version').eq('stylist_id', m.stylist_id).maybeSingle()
      : { data: null }

    const { data: profile } = m.style_profile_id
      ? await admin.from('style_profile').select('name, source_member_id').eq('profile_id', m.style_profile_id).maybeSingle()
      : { data: null }

    const { data: rules } = await admin.from('learned_rule').select('scope, pattern_label')
      .eq('active', true).eq('stylist_id', m.stylist_id ?? '00000000-0000-0000-0000-000000000000')
    const stylistRules = (rules ?? []).filter((r: any) => r.scope === 'stylist')
    const styleRules = (rules ?? []).filter((r: any) => r.scope === 'style')

    const [{ count: brandsCoded }, { count: itemsInStock }] = await Promise.all([
      admin.from('brand').select('brand_id', { count: 'exact', head: true }),
      admin.from('item').select('item_id', { count: 'exact', head: true }).in('status', ['ready', 'live']).eq('available', true),
    ])

    // Brand readiness: the brands she named that the harness cannot work with.
    const named: string[] = (m.brands ?? []).map((b: any) => b?.name).filter(Boolean)
    const fold = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const { data: brandRows } = await admin.from('brand').select('brand_id, name')
    const byName = new Map((brandRows ?? []).map((b: any) => [fold(b.name), b.brand_id]))
    const readiness: { name: string; issue: string }[] = []
    for (const n of named) {
      const id = byName.get(fold(n))
      if (!id) { readiness.push({ name: n, issue: 'not coded — no brand record' }); continue }
      const { count } = await admin.from('item').select('item_id', { count: 'exact', head: true })
        .eq('brand_id', id).in('status', ['ready', 'live']).eq('available', true)
      if (!count) readiness.push({ name: n, issue: 'coded but nothing in stock' })
      else if (count < 10) readiness.push({ name: n, issue: `thin — ${count} pieces in stock` })
    }

    // The baseline is the FIRST client under this stylist.
    const { points } = await loadTransferSeries()
    const sameStylist = points.filter((p) => p.memberId !== memberId)
    const baselinePoint = sameStylist[0] ?? null
    const predicted = predictedCleanRate(baselinePoint?.cleanRate ?? null, {
      stylist: stylistRules.length, style: styleRules.length,
    })

    const meaningful = 0.05
    const verdict = predicted.predicted == null
      ? 'First client under this stylist — she IS the baseline.'
      : predicted.predicted - (baselinePoint?.cleanRate ?? 0) >= meaningful
        ? `Predicted to start above ${baselinePoint?.name ?? 'the baseline'} — the harness is carrying something.`
        : 'NOT TRANSFERRING — her predicted start is no better than the last client’s actual. Nothing learned so far generalises; expect to review every look.'

    return {
      memberName: m.name,
      stylistName: stylist?.name ?? 'unassigned',
      constitutionVersion: stylist?.constitution_version ?? 1,
      styleProfile: profile ? { name: profile.name, matched: profile.source_member_id !== memberId } : null,
      globalLayer: {
        brandsCoded: brandsCoded ?? 0,
        itemsInStock: itemsInStock ?? 0,
        enginePasses: ['in stock', 'in her size', 'no duplicate slots', 'vector scoring', 'brand families and price positions'],
      },
      inheritedRules: {
        stylist: stylistRules.length,
        style: styleRules.length,
        labels: [...stylistRules, ...styleRules].slice(0, 8).map((r: any) => `${r.scope.toUpperCase()} · ${r.pattern_label}`),
      },
      startsEmpty: ['brand affinities', 'sizes', 'wardrobe', 'graduation counters', 'her own swap history'],
      brandReadiness: readiness,
      predicted,
      baseline: baselinePoint ? { name: baselinePoint.name, cleanRate: baselinePoint.cleanRate } : null,
      verdict,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not build the report' }
  }
}

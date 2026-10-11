// WAYS TO WEAR IT — the pictures (migration 0097).
//
// A kept way is a judged outfit drawn as its pieces. Here MYRA makes its
// picture: the same Higgsfield shoot a saved look gets (pose E5, one
// generation, fidelity-checked), written onto the styled_way row so the
// sheet opens on the picture and a later save needs no second shoot.
//
// The shoot runs through the local Higgsfield CLI, so this works on Chloe's
// Mac only — /api/cron/styled-ways-render, opened locally, never on Vercel.
// Chloe asked (2026-10-11) for her own ways rendered ahead; other members
// are opt-in (STYLED_WAYS_RENDER_MEMBERS=all).

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { HIGGSFIELD_COMBOS, buildGenerationPrompt, buildReferenceUrls, type ShootItem } from '@/lib/higgsfield-shoot'
import { runHiggsfieldGeneration, getHiggsfieldJob } from '@/app/admin/projects/higgsfield-actions'
import { persistImageToCloudinary } from '@/lib/cloudinary-persist'
import { checkRenderFidelity } from '@/app/admin/ai/render-fidelity'
import { rendererAvailable } from '@/lib/studio/render-queue'
import { slotForItemType } from '@/lib/composer'
import type { LookItem } from '@/lib/pilot-stylist'

export interface ShootWayResult { imageUrl?: string; error?: string; fidelity?: number | null; ms: number }

/** A shoot the provider accepted but whose result was not retrieved: kept on the row as `accepted:<job ids>`. */
const ACCEPTED = 'accepted:'

/** Check before showing: the picture must match the clothes, or it is not kept. */
async function fidelityOf(imageUrl: string, shootItems: ShootItem[]): Promise<{ ok: boolean; score: number | null; error?: string }> {
  try {
    const check = await checkRenderFidelity(imageUrl, shootItems
      .filter((i): i is ShootItem & { image_url: string } => !!i.image_url)
      .map((i) => ({ label: [i.brand_name, i.product_name].filter(Boolean).join(' — ') || String(i.item_type), image_url: i.image_url })))
    if (!check.passed && !check.error) {
      return { ok: false, score: check.score, error: `fidelity ${Math.round(check.score * 100)}%: ${check.issues?.slice(0, 2).map((x: any) => x?.issue ?? x).join('; ')}`.slice(0, 300) }
    }
    return { ok: true, score: check.score }
  } catch (err) { console.error('[styled-ways-shoot] fidelity', err); return { ok: true, score: null } }
}

/** Make the picture of one kept way and write it onto the row. */
export async function shootStyledWay(admin: any, styledWayId: string, poseKey = 'E5'): Promise<ShootWayResult> {
  const t0 = Date.now()
  const done = (r: Omit<ShootWayResult, 'ms'>): ShootWayResult => ({ ...r, ms: Date.now() - t0 })
  if (!rendererAvailable()) return done({ error: 'Higgsfield CLI is not on this machine' })

  const { data: row } = await admin.from('styled_way').select('styled_way_id, items, image_url, stale, shoot_error').eq('styled_way_id', styledWayId).maybeSingle()
  if (!row) return done({ error: 'Way not found' })
  if (row.image_url) return done({ imageUrl: row.image_url })
  if (row.stale) return done({ error: 'Way is retired' })
  const items: LookItem[] = (row.items ?? []) as LookItem[]

  // Fill shoot fields from the item table where the kept look lacks them.
  const missing = items.filter((it) => it.item_id && (!it.image_url || !it.item_type))
  if (missing.length) {
    const { data: rows } = await admin.from('item').select('item_id, image_url, item_type, material_primary').in('item_id', missing.map((it) => it.item_id))
    const byId = new Map<string, any>(((rows ?? []) as any[]).map((r) => [r.item_id, r]))
    for (const it of missing) {
      const r = byId.get(it.item_id as string)
      if (r) {
        it.image_url = it.image_url ?? r.image_url
        it.item_type = it.item_type ?? r.item_type
        it.material_primary = it.material_primary ?? r.material_primary
        it.slot = it.slot ?? (r.item_type ? slotForItemType(r.item_type) : null)
      }
    }
  }
  // Owned pieces first: references cap at five and her own pieces must render exactly.
  const shootItems: ShootItem[] = [...items]
    .sort((a, b) => Number(Boolean(b.owned)) - Number(Boolean(a.owned)))
    .filter((it) => it.image_url)
    .map((it) => ({
      product_name: it.product_name,
      item_type: (it.item_type ?? 'blouse') as any,
      material_primary: it.material_primary ?? null,
      slot: (it.slot ?? 'top') as any,
      image_url: it.image_url as string,
      brand_name: it.brand ?? null,
    }))
  if (!shootItems.length) {
    await admin.from('styled_way').update({ shoot_error: 'No item images on this way' }).eq('styled_way_id', styledWayId)
    return done({ error: 'No item images on this way' })
  }

  const keep = async (imageUrl: string): Promise<ShootWayResult> => {
    const f = await fidelityOf(imageUrl, shootItems)
    if (!f.ok) {
      await admin.from('styled_way').update({ shoot_error: f.error }).eq('styled_way_id', styledWayId)
      return done({ error: f.error, fidelity: f.score })
    }
    await admin.from('styled_way').update({ image_url: imageUrl, image_at: new Date().toISOString(), shoot_error: null }).eq('styled_way_id', styledWayId)
    return done({ imageUrl, fidelity: f.score })
  }

  // RECOVERY — the provider accepted (and charged for) a shoot whose result
  // never came back: read it by job id rather than paying for another.
  if (typeof row.shoot_error === 'string' && row.shoot_error.startsWith(ACCEPTED)) {
    const jobIds = String(row.shoot_error).slice(ACCEPTED.length).split(',').map((s: string) => s.trim()).filter(Boolean)
    for (const jobId of jobIds) {
      const job = await getHiggsfieldJob(jobId)
      if (job.state === 'pending') return done({ error: 'Still rendering at Higgsfield — try again in a minute' })
      if (job.state === 'completed' && job.imageUrl) {
        const url = (await persistImageToCloudinary(job.imageUrl, { folder: 'higgsfield-shoots', publicId: `styled-way-${styledWayId}-${jobId.slice(0, 8)}` })) ?? job.imageUrl
        return keep(url)
      }
    }
    const error = `accepted shoot could not be recovered (${jobIds.join(', ')})`.slice(0, 300)
    await admin.from('styled_way').update({ shoot_error: error }).eq('styled_way_id', styledWayId)
    return done({ error })
  }

  const combo = HIGGSFIELD_COMBOS[poseKey] ?? HIGGSFIELD_COMBOS.E5
  const prompt = buildGenerationPrompt(combo, shootItems)
  const refs = buildReferenceUrls(combo, shootItems)
  const gen = await runHiggsfieldGeneration(prompt, refs, `styled-way-${styledWayId}-${Date.now()}`)
  if (!gen.imageUrl) {
    // Accepted but not retrieved: remember the job ids so the next run recovers for free.
    const error = gen.submitted && gen.providerJobIds?.length
      ? `${ACCEPTED}${gen.providerJobIds.join(',')}`
      : (gen.error ?? 'Shoot returned no picture').slice(0, 300)
    await admin.from('styled_way').update({ shoot_error: error }).eq('styled_way_id', styledWayId)
    return done({ error })
  }
  return keep(gen.imageUrl)
}

/** Which members get pictures made ahead: Chloe's own, or everyone when STYLED_WAYS_RENDER_MEMBERS=all. */
async function renderMembers(admin: any, memberId?: string): Promise<string[]> {
  if (memberId) return [memberId]
  if (process.env.STYLED_WAYS_RENDER_MEMBERS === 'all') {
    const { data } = await admin.from('pilot_member').select('member_id').eq('is_synthetic', false).not('auth_user_id', 'is', null)
    return ((data ?? []) as any[]).map((m) => m.member_id)
  }
  const { data } = await admin.from('pilot_member').select('member_id').eq('auth_user_id', process.env.ADMIN_USER_ID ?? '').limit(1)
  return ((data ?? []) as any[]).map((m) => m.member_id)
}

/**
 * Make pictures for kept ways that have none, newest first, one at a time
 * (the CLI is one machine), until the limit or the budget runs out.
 */
export async function renderStyledWays(opts: { memberId?: string; limit?: number; budgetMs?: number } = {}):
  Promise<{ members: number; wanted: number; made: number; failed: number; skipped?: string; results: { id: string; ok: boolean; note: string; ms: number }[] }> {
  const admin = createAdminClient() as any
  if (!rendererAvailable()) return { members: 0, wanted: 0, made: 0, failed: 0, skipped: 'Higgsfield CLI is not on this machine', results: [] }
  const members = await renderMembers(admin, opts.memberId)
  const limit = opts.limit ?? 6
  const budgetMs = opts.budgetMs ?? 20 * 60_000
  const startedAt = Date.now()
  const results: { id: string; ok: boolean; note: string; ms: number }[] = []
  let wanted = 0
  let made = 0
  let failed = 0
  for (const memberId of members) {
    // Never shot, or accepted-and-unretrieved (recovered for free, so they go first).
    const { data: rows } = await admin.from('styled_way').select('styled_way_id, shoot_error')
      .eq('member_id', memberId).eq('stale', false).is('image_url', null)
      .or(`shoot_error.is.null,shoot_error.like.${ACCEPTED}%`)
      .order('judged_at', { ascending: false }).limit(limit * 2)
    const ids = ((rows ?? []) as any[])
      .sort((a, b) => Number(!!b.shoot_error) - Number(!!a.shoot_error))
      .slice(0, limit)
      .map((r) => r.styled_way_id as string)
    wanted += ids.length
    for (const id of ids) {
      if (made + failed >= limit || Date.now() - startedAt > budgetMs) break
      const r = await shootStyledWay(admin, id)
      if (r.imageUrl) made++; else failed++
      results.push({ id, ok: !!r.imageUrl, note: r.error ?? `fidelity ${r.fidelity == null ? '—' : Math.round(r.fidelity * 100) + '%'}`, ms: r.ms })
    }
  }
  return { members: members.length, wanted, made, failed, results }
}

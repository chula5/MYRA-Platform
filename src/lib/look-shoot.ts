// HER LOOKS — the pictures (LOCAL ONLY, like lib/styled-ways-shoot).
//
// Chloe, 2026-10-20: a look in her Looks room opened on a close-up of one
// earring, because 34 of her 39 looks had never been shot — the card falls
// back to the pieces. Every look should show MYRA's Higgsfield shoot of the
// whole outfit. The shoot runs through the Higgsfield CLI on her Mac, so this
// fills in the looks that have no picture, newest first, one at a time, and
// on Vercel it simply reports that the renderer is not there.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { rendererAvailable } from '@/lib/studio/render-queue'
import { renderMembers } from '@/lib/styled-ways-shoot'
import { higgsfieldShootForLook } from '@/app/admin/private-stylist/actions'

/** A look shot in the last day that still has no picture failed its fidelity check — leave it for a person. */
const RETRY_AFTER_MS = 24 * 3_600_000

export async function renderMemberLooks(opts: { memberId?: string; limit?: number; budgetMs?: number } = {}):
  Promise<{ members: number; wanted: number; made: number; failed: number; skipped?: string; results: { id: string; ok: boolean; note: string; ms: number }[] }> {
  const admin = createAdminClient() as any
  if (!rendererAvailable()) return { members: 0, wanted: 0, made: 0, failed: 0, skipped: 'Higgsfield CLI is not on this machine', results: [] }
  const members = await renderMembers(admin, opts.memberId)
  const limit = opts.limit ?? 6
  const budgetMs = opts.budgetMs ?? 20 * 60_000
  const startedAt = Date.now()
  const results: { id: string; ok: boolean; note: string; ms: number }[] = []
  let wanted = 0, made = 0, failed = 0
  for (const memberId of members) {
    const { data: dels } = await admin.from('pilot_delivery').select('delivery_id').eq('member_id', memberId)
    const ids = ((dels ?? []) as any[]).map((d) => d.delivery_id)
    if (!ids.length) continue
    const { data: rows } = await admin.from('pilot_look').select('look_id, shoot_history, response')
      .in('delivery_id', ids).eq('visible_to_client', true).is('image_url', null)
      .order('published_at', { ascending: false }).limit(limit * 4)
    const todo = ((rows ?? []) as any[])
      .filter((r) => r.response !== 'no')
      .filter((r) => {
        const last = (Array.isArray(r.shoot_history) ? r.shoot_history : []).map((h: any) => Date.parse(h?.created_at ?? '')).filter(Number.isFinite)
        return !last.length || Date.now() - Math.max(...last) > RETRY_AFTER_MS
      })
      .slice(0, limit)
    wanted += todo.length
    for (const r of todo) {
      if (made + failed >= limit || Date.now() - startedAt > budgetMs) break
      const t0 = Date.now()
      // Light: one generation and one fidelity check — a failed check keeps the render in history, not on the look.
      const res = await higgsfieldShootForLook(r.look_id, 'E5', { light: true }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as { imageUrl?: string; error?: string }))
      if (res.imageUrl) made++; else failed++
      results.push({ id: r.look_id, ok: !!res.imageUrl, note: res.error ?? 'shot', ms: Date.now() - t0 })
    }
  }
  return { members: members.length, wanted, made, failed, results }
}


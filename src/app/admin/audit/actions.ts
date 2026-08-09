'use server'

// AUDIT for auto-published outfits (Stage 2/3). Any swap or pull here is an
// INTERVENTION: it resets the streak and demotes the stylist's autonomy stage
// immediately, with the reason logged.

import { createAdminClient } from '@/lib/supabase-server'
import { foldAuditIntervention } from '@/lib/stylist-store'
import { revalidatePath } from 'next/cache'

export interface AuditEntry {
  id: string
  outfit_id: string
  stylist_id: string
  styling_set_id: string | null
  stage: number
  published_at: string
  audit_action: string | null
  image_url: string | null
  aesthetic_label: string | null
  project_id: string | null
}

export async function loadAuditEntries(sinceHours = 72): Promise<AuditEntry[]> {
  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - sinceHours * 3600000).toISOString()
    const { data } = await admin
      .from('auto_publish_log' as any)
      .select('*')
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(100)
    const rows = (data ?? []) as any[]
    if (!rows.length) return []
    const { data: outfits } = await admin
      .from('outfit' as any)
      .select('outfit_id, image_url, aesthetic_label, project_id')
      .in('outfit_id', rows.map((r) => r.outfit_id))
    const byId = new Map(((outfits ?? []) as any[]).map((o) => [o.outfit_id, o]))
    return rows.map((r) => {
      const o = byId.get(r.outfit_id)
      return {
        id: r.id,
        outfit_id: r.outfit_id,
        stylist_id: r.stylist_id,
        styling_set_id: r.styling_set_id ?? null,
        stage: r.stage,
        published_at: r.published_at,
        audit_action: r.audit_action ?? null,
        image_url: o?.image_url ?? null,
        aesthetic_label: o?.aesthetic_label ?? null,
        project_id: o?.project_id ?? null,
      }
    })
  } catch {
    return []
  }
}

// PULL: unpublish immediately (back to draft) + demote. The one-tap link from
// the digest lands here.
export async function auditPull(logId: string): Promise<{ ok?: true; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: log } = await admin.from('auto_publish_log' as any).select('*').eq('id', logId).maybeSingle()
    if (!log) return { error: 'Audit entry not found' }
    const l = log as any
    await (admin.from('outfit') as any)
      .update({ status: 'draft', paused_reason: 'pulled during autonomy audit' })
      .eq('outfit_id', l.outfit_id)
    await (admin.from('auto_publish_log') as any)
      .update({ audited_at: new Date().toISOString(), audit_action: 'pulled' })
      .eq('id', logId)
    await foldAuditIntervention(l.stylist_id, 'pulled')
    revalidatePath('/admin/audit')
    revalidatePath('/admin')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Pull failed' }
  }
}

// SWAP-flag: she's about to edit the outfit — count the intervention and send
// her to the draft's swap sheet. The outfit is unpublished while edited.
export async function auditSwap(logId: string): Promise<{ ok?: true; outfitId?: string; projectId?: string | null; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data: log } = await admin.from('auto_publish_log' as any).select('*').eq('id', logId).maybeSingle()
    if (!log) return { error: 'Audit entry not found' }
    const l = log as any
    await (admin.from('outfit') as any)
      .update({ status: 'draft', paused_reason: 'swapped during autonomy audit' })
      .eq('outfit_id', l.outfit_id)
    await (admin.from('auto_publish_log') as any)
      .update({ audited_at: new Date().toISOString(), audit_action: 'swapped' })
      .eq('id', logId)
    await foldAuditIntervention(l.stylist_id, 'swapped')
    const { data: outfit } = await admin.from('outfit' as any).select('project_id').eq('outfit_id', l.outfit_id).maybeSingle()
    revalidatePath('/admin/audit')
    revalidatePath('/admin')
    return { ok: true, outfitId: l.outfit_id, projectId: (outfit as any)?.project_id ?? null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Swap flag failed' }
  }
}

export async function auditKeep(logId: string): Promise<{ ok: true }> {
  try {
    const admin = createAdminClient()
    await (admin.from('auto_publish_log') as any)
      .update({ audited_at: new Date().toISOString(), audit_action: 'kept' })
      .eq('id', logId)
    revalidatePath('/admin/audit')
  } catch (err) {
    console.error('[auditKeep]', err)
  }
  return { ok: true }
}

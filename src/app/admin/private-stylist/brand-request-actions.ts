'use server'

// WHAT THE CLIENTS ARE ASKING FOR.
//
// A member can now name her own brands, in onboarding and in her settings. Most
// resolve to a brand MYRA already has. The ones that do not are the interesting
// half: they are unprompted, specific demand, named by the exact person the
// pilot exists to serve, and before this they went into unmatched_brand_log and
// were never read by anybody.
//
// This is a reading surface, not an automation. Adding a brand to the watchlist
// costs a full catalogue scrape and needs a storefront URL rather than a name,
// so what happens next is Chloe's call in /admin/brand-watch — here she sees
// who asked, how many asked, and can mark a name as dealt with so the list
// stays a list of things to do.

import { assertAdmin, writeAudit, requireAdminUser } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase-server'
import { brandKey } from '@/lib/brand-affinity'
import { isMissingTable } from '@/lib/metrics-core'

export interface BrandRequest {
  /** The name as she typed it, from the most recent person who asked. */
  name: string
  /** How many separate times it has been asked for. */
  asks: number
  /** The members who asked, by name. */
  members: string[]
  /** When it was last asked for. */
  lastAskedAt: string
  /** Every log row behind this name, so marking it handled clears them all. */
  logIds: string[]
}

export interface BrandRequestList {
  /** False until 0064_client_brand_requests.sql has been run. */
  available: boolean
  requests: BrandRequest[]
}

export async function loadBrandRequests(): Promise<BrandRequestList> {
  await assertAdmin()
  const admin = createAdminClient() as any
  try {
    const { data, error } = await admin
      .from('unmatched_brand_log')
      .select('log_id, raw_name, user_id, created_at')
      .is('handled_at', null)
      .order('created_at', { ascending: false })
      .limit(500)
    // Before 0064 there is no handled_at to filter on. Reporting that as an
    // empty list would say "nobody has asked for anything", which is a
    // different and much worse answer than "run the migration".
    if (error) return { available: !isMissingTable(error) && !/handled_at/i.test(error.message ?? ''), requests: [] }

    const rows = (data ?? []) as any[]
    if (!rows.length) return { available: true, requests: [] }

    const memberIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)))
    const nameById = new Map<string, string>()
    if (memberIds.length) {
      const { data: members } = await admin
        .from('pilot_member')
        .select('member_id, name')
        .in('member_id', memberIds)
      for (const m of (members ?? []) as any[]) nameById.set(m.member_id, m.name)
    }

    // One row per BRAND, not per ask: three people asking for Toteme is one
    // decision to make, and the count is the argument for making it.
    const byBrand = new Map<string, BrandRequest>()
    for (const r of rows) {
      const raw = String(r.raw_name ?? '').trim()
      const key = brandKey(raw)
      if (!key) continue
      const who = nameById.get(r.user_id) ?? null
      const found = byBrand.get(key)
      if (found) {
        found.asks++
        found.logIds.push(r.log_id)
        if (who && !found.members.includes(who)) found.members.push(who)
        continue
      }
      byBrand.set(key, {
        name: raw,
        asks: 1,
        members: who ? [who] : [],
        lastAskedAt: r.created_at,
        logIds: [r.log_id],
      })
    }

    const requests = Array.from(byBrand.values())
      .sort((a, b) => b.asks - a.asks || b.lastAskedAt.localeCompare(a.lastAskedAt))
    return { available: true, requests }
  } catch (err) {
    console.error('[loadBrandRequests]', err)
    return { available: false, requests: [] }
  }
}

/** Mark every ask for a brand as dealt with — stocked, watched, or declined. */
export async function handleBrandRequest(
  logIds: string[],
  note: string,
): Promise<{ error?: string }> {
  await assertAdmin()
  if (!Array.isArray(logIds) || !logIds.length) return { error: 'NOTHING TO CLEAR' }
  const admin = createAdminClient() as any
  try {
    const { error } = await admin
      .from('unmatched_brand_log')
      .update({ handled_at: new Date().toISOString(), note: note.trim().slice(0, 300) || null })
      .in('log_id', logIds.slice(0, 200))
    if (error) {
      return { error: isMissingTable(error) || /handled_at/i.test(error.message ?? '')
        ? 'RUN 0064_CLIENT_BRAND_REQUESTS.SQL FIRST'
        : error.message }
    }
    const { userId } = await requireAdminUser()
    await writeAudit({
      actor: userId ?? 'admin',
      action: 'brand_request_handled',
      entityType: 'unmatched_brand_log',
      entityId: logIds[0],
      reason: note.trim() || undefined,
      detail: { asks: logIds.length },
    })
    return {}
  } catch (err) {
    console.error('[handleBrandRequest]', err)
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

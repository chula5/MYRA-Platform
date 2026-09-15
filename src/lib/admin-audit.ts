// Part 7 shared plumbing: admin gate for server actions + the append-only
// audit trail. Every mutating admin action calls writeAudit — no exceptions.

import { createServerClient, createAdminClient } from '@/lib/supabase-server'

export async function requireAdminUser(): Promise<{ ok: boolean; userId: string | null }> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user && user.id === process.env.ADMIN_USER_ID) return { ok: true, userId: user.id }
    return { ok: false, userId: null }
  } catch {
    return { ok: false, userId: null }
  }
}

// The gate for server actions that have no error shape to return: every export
// of a 'use server' file is callable by anyone from the browser, so the first
// line of an admin action is this.
export async function assertAdmin(): Promise<void> {
  const { ok } = await requireAdminUser()
  if (!ok) throw new Error('Not authorised')
}

export async function writeAudit(opts: {
  actor: string
  action: string
  entityType: string
  entityId?: string | null
  reason?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('admin_audit_log' as any).insert({
      actor: opts.actor,
      action: opts.action,
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
      reason: opts.reason ?? null,
      detail: (opts.detail ?? null) as any,
    } as any)
  } catch (err) {
    console.error('[audit] write failed', err instanceof Error ? err.message : err)
  }
}

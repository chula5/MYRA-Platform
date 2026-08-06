// Audit log — every automated Studio action lands here: auto-swaps, pauses,
// archives, renders, undo/restore. Never throws into the caller.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'

export type AuditTrigger = 'mobile_review' | 'stock_sentinel' | 'email_link' | 'cron' | 'desktop' | 'system'

export async function writeAudit(opts: {
  action: string
  entity: 'outfit' | 'item' | 'render_job'
  entityId: string | null
  trigger: AuditTrigger
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await (admin.from('audit_log') as any).insert({
      action: opts.action,
      entity: opts.entity,
      entity_id: opts.entityId,
      trigger: opts.trigger,
      before: opts.before ?? null,
      after: opts.after ?? null,
    })
  } catch (err) {
    console.error('[writeAudit]', opts.action, err)
  }
}

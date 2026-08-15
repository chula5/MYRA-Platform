'use server'

// Manual ledger interventions (Part 7). Reason is MANDATORY — every adjustment
// is written to commission_event AND admin_audit_log with the acting admin.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { requireAdminUser, writeAudit } from '@/lib/admin-audit'
import { transition } from '@/lib/ledger/store'
import type { CommissionStatus } from '@/lib/ledger/logic'

export async function adjustCommission(input: {
  commissionId: string
  to: 'approved' | 'void' | 'returned' | 'paid'
  reason: string
}): Promise<{ ok?: true; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  const reason = input.reason?.trim()
  if (!reason || reason.length < 5) return { error: 'A reason is required (min 5 characters)' }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('commission' as any)
    .select('status')
    .eq('commission_id', input.commissionId)
    .maybeSingle()
  if (!row) return { error: 'Commission not found' }
  const from = (row as any).status as CommissionStatus

  // Manual paid: approved rows may be marked payable→paid in one action
  // (manual-phase settlement without Part 5's invoice sweep).
  if (input.to === 'paid' && from === 'approved') {
    const step = await transition(input.commissionId, 'approved', 'payable', gate.userId!, `(manual settle) ${reason}`)
    if (!step.ok) return { error: step.error }
    const fin = await transition(input.commissionId, 'payable', 'paid', gate.userId!, reason)
    if (!fin.ok) return { error: fin.error }
  } else {
    const res = await transition(input.commissionId, from, input.to, gate.userId!, reason)
    if (!res.ok) return { error: res.error }
  }

  await writeAudit({
    actor: gate.userId!, action: `ledger.${input.to}`, entityType: 'commission',
    entityId: input.commissionId, reason,
  })
  revalidatePath('/admin/ledger')
  return { ok: true }
}

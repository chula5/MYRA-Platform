'use server'

// Merchant admin: rates, return windows, and manual merchant creation for
// brands running without the Shopify app (the manual phase). All mutations
// audited with actor + reason.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { requireAdminUser, writeAudit } from '@/lib/admin-audit'

export async function updateMerchantCommercials(input: {
  merchantId: string
  defaultRate?: number
  returnWindowDays?: number
  billingModel?: 'prefunded' | 'invoiced'
}): Promise<{ ok?: true; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  const patch: Record<string, unknown> = {}
  if (input.defaultRate != null) {
    if (!(input.defaultRate > 0 && input.defaultRate < 1)) return { error: 'Rate must be between 0 and 1 (e.g. 0.15)' }
    patch.default_commission_rate = input.defaultRate
  }
  if (input.returnWindowDays != null) {
    if (!(input.returnWindowDays >= 0 && input.returnWindowDays <= 120)) return { error: 'Window must be 0–120 days' }
    patch.return_window_days = input.returnWindowDays
  }
  if (input.billingModel) patch.billing_model = input.billingModel
  if (!Object.keys(patch).length) return { error: 'Nothing to update' }

  const admin = createAdminClient()
  const { error } = await admin.from('merchant' as any).update(patch as any).eq('merchant_id', input.merchantId)
  if (error) return { error: error.message }
  await writeAudit({
    actor: gate.userId!, action: 'merchant.update_commercials', entityType: 'merchant',
    entityId: input.merchantId, detail: patch,
  })
  revalidatePath('/admin/merchants')
  return { ok: true }
}

export async function createManualMerchant(input: {
  name: string
  trackingTemplate?: string
}): Promise<{ ok?: true; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  const name = input.name.trim()
  if (!name) return { error: 'Name required' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('merchant' as any).insert({
    name,
    type: 'manual',
    link_mode: 'redirect',
    tracking_param_template: input.trackingTemplate?.trim() || 'utm_source=myra&utm_medium=affiliate&myra_click={click_id}',
  } as any).select('merchant_id').single()
  if (error) return { error: error.message }
  await writeAudit({ actor: gate.userId!, action: 'merchant.create_manual', entityType: 'merchant', entityId: (data as any).merchant_id, detail: { name } })
  revalidatePath('/admin/merchants')
  return { ok: true }
}

export async function setTerms(input: {
  merchantId: string
  baseRate: number
  introRate?: number | null
  introExpiresAt?: string | null   // ISO date
  termsText?: string
}): Promise<{ ok?: true; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  if (!(input.baseRate > 0 && input.baseRate < 1)) return { error: 'Base rate must be between 0 and 1' }
  if (input.introRate != null && !(input.introRate > 0 && input.introRate < 1)) return { error: 'Intro rate must be between 0 and 1' }

  const admin = createAdminClient()
  const { data: last } = await admin
    .from('commission_terms' as any)
    .select('version')
    .eq('merchant_id', input.merchantId)
    .order('version', { ascending: false })
    .limit(1)
  const version = (((last as any[]) ?? [])[0]?.version ?? 0) + 1

  // Terms are immutable: changes are a NEW version (Part 6 re-acceptance).
  const { error } = await admin.from('commission_terms' as any).insert({
    merchant_id: input.merchantId,
    version,
    base_rate: input.baseRate,
    intro_rate: input.introRate ?? null,
    intro_expires_at: input.introExpiresAt ?? null,
    terms_text: input.termsText ?? null,
  } as any)
  if (error) return { error: error.message }
  await writeAudit({
    actor: gate.userId!, action: 'terms.new_version', entityType: 'commission_terms',
    entityId: input.merchantId, detail: { version, baseRate: input.baseRate, introRate: input.introRate ?? null },
  })
  revalidatePath('/admin/merchants')
  return { ok: true }
}

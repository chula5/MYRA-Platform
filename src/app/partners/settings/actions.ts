'use server'

// Partner settings (Part 4) + terms acceptance (Part 6). Writes go through the
// service role AFTER the partner context is verified — the context itself is
// established via RLS-scoped reads, and owner-only actions check the role.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { getPartnerContext } from '@/lib/partners/auth'

export async function updateBillingDetails(formData: FormData): Promise<void> {
  const ctx = await getPartnerContext()
  if (!ctx || ctx.role !== 'owner') return
  const admin = createAdminClient()
  await admin.from('merchant' as any).update({
    billing_contact_email: String(formData.get('billing_email') ?? '').trim() || null,
    vat_number: String(formData.get('vat') ?? '').trim() || null,
  } as any).eq('merchant_id', ctx.merchantId)
  revalidatePath('/partners/settings')
}

// Accepting terms is the commercial agreement: stored immutably with who and
// when, on the exact version shown.
export async function acceptTerms(termsId: string): Promise<{ ok?: true; error?: string }> {
  const ctx = await getPartnerContext()
  if (!ctx) return { error: 'Not authorised' }
  if (ctx.role !== 'owner') return { error: 'Only the account owner can accept terms' }

  const admin = createAdminClient()
  const { data: terms } = await admin
    .from('commission_terms' as any)
    .select('terms_id, merchant_id, accepted_at')
    .eq('terms_id', termsId)
    .maybeSingle()
  const t = terms as any
  if (!t || t.merchant_id !== ctx.merchantId) return { error: 'Terms not found' }
  if (t.accepted_at) return { error: 'Already accepted' }

  await admin.from('commission_terms' as any).update({
    accepted_at: new Date().toISOString(),
    accepted_by: ctx.userId,
  } as any).eq('terms_id', termsId)
  revalidatePath('/partners/settings')
  return { ok: true }
}

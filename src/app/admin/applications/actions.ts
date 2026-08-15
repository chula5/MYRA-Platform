'use server'

// Application review (Part 6). Approval creates the merchant + terms v1 at the
// rate CHLOE sets (never chosen by the brand). Emails go via Resend when
// configured; otherwise the decision is recorded and the email is on her.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { requireAdminUser, writeAudit } from '@/lib/admin-audit'

async function sendDecisionEmail(to: string, subject: string, body: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'MYRA <hello@myraassistant.co.uk>',
        to,
        subject,
        text: body,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function approveApplication(input: {
  applicationId: string
  rate: number
}): Promise<{ ok?: true; emailed?: boolean; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  if (!(input.rate > 0 && input.rate < 1)) return { error: 'Rate must be between 0 and 1 (e.g. 0.18)' }

  const admin = createAdminClient()
  const { data: app } = await admin.from('brand_application' as any).select('*').eq('application_id', input.applicationId).maybeSingle()
  const a = app as any
  if (!a) return { error: 'Application not found' }
  if (a.status !== 'pending') return { error: `Already ${a.status}` }

  const { data: merchant, error: mErr } = await admin.from('merchant' as any).insert({
    name: a.brand_name,
    type: 'manual',
    link_mode: 'redirect',
    tracking_param_template: 'utm_source=myra&utm_medium=affiliate&myra_click={click_id}',
    billing_contact_email: a.contact_email,
    default_commission_rate: input.rate,
  } as any).select('merchant_id').single()
  if (mErr) return { error: mErr.message }
  const merchantId = (merchant as any).merchant_id

  await admin.from('commission_terms' as any).insert({
    merchant_id: merchantId,
    version: 1,
    base_rate: input.rate,
    terms_text: `Commission of ${(input.rate * 100).toFixed(0)}% on MYRA-attributed sales. 30-day return window.`,
  } as any)

  await admin.from('brand_application' as any).update({
    status: 'approved',
    reviewed_by: gate.userId,
    reviewed_at: new Date().toISOString(),
    merchant_id: merchantId,
  } as any).eq('application_id', input.applicationId)

  const emailed = await sendDecisionEmail(
    a.contact_email,
    `MYRA × ${a.brand_name} — welcome`,
    `Hi ${a.contact_name || 'there'},\n\nGood news — ${a.brand_name} has been approved to join MYRA.\n\nWe'll follow up shortly with your store connection link and partner dashboard invitation.\n\nChloe\nMYRA · myraassistant.co.uk`,
  )
  await writeAudit({ actor: gate.userId!, action: 'application.approve', entityType: 'brand_application', entityId: input.applicationId, detail: { merchantId, rate: input.rate, emailed } })
  revalidatePath('/admin/applications')
  return { ok: true, emailed }
}

export async function rejectApplication(input: {
  applicationId: string
  note?: string
}): Promise<{ ok?: true; emailed?: boolean; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }

  const admin = createAdminClient()
  const { data: app } = await admin.from('brand_application' as any).select('*').eq('application_id', input.applicationId).maybeSingle()
  const a = app as any
  if (!a) return { error: 'Application not found' }
  if (a.status !== 'pending') return { error: `Already ${a.status}` }

  await admin.from('brand_application' as any).update({
    status: 'rejected',
    reviewed_by: gate.userId,
    reviewed_at: new Date().toISOString(),
    review_note: input.note ?? null,
  } as any).eq('application_id', input.applicationId)

  const emailed = await sendDecisionEmail(
    a.contact_email,
    `MYRA × ${a.brand_name}`,
    `Hi ${a.contact_name || 'there'},\n\nThank you for applying to join MYRA. We keep the platform deliberately small and curated, and we won't be moving forward together right now.\n\nWe'd genuinely encourage you to apply again as your collection evolves.\n\nChloe\nMYRA · myraassistant.co.uk`,
  )
  await writeAudit({ actor: gate.userId!, action: 'application.reject', entityType: 'brand_application', entityId: input.applicationId, detail: { emailed } })
  revalidatePath('/admin/applications')
  return { ok: true, emailed }
}

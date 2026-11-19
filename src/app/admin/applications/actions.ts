'use server'

// APPLICATIONS — the people who pressed APPLY NOW on the landing page.
//
// ACCEPT makes her a member in one press: a pilot_member on Chloe's base with
// the brands she named already ranked (the ones MYRA knows) or kept as her own
// words (the ones it does not), her email written on the door, a 14-day /join
// link minted, and her invitation emailed as MYRA. DECLINE only records it:
// no email goes out. Every export here is public to the browser, so each one
// starts by proving the admin session.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { requireAdminUser, writeAudit } from '@/lib/admin-audit'
import { INVITE_DAYS } from '@/lib/member-invite'
import { sendInvitationEmail } from '@/lib/studio/invitation-email'
import { acceptApplicationCore, inviteUrlFor, type AcceptResult, type ApplicationRow } from '@/lib/applications/accept'
import { writeSwitch } from '@/lib/site-switch'

const PATH = '/admin/applications'

export type { ApplicationRow, AcceptResult } from '@/lib/applications/accept'

export async function acceptApplication(applicationId: string): Promise<AcceptResult> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  return acceptApplicationCore(createAdminClient() as any, applicationId, gate.userId!)
}

/** AUTO-ACCEPT: when on, a sign-up becomes a member and gets her invitation at once. */
export async function setAutoAccept(on: boolean): Promise<{ ok?: true; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  const res = await writeSwitch(createAdminClient() as any, 'auto_accept_applications', on, gate.userId)
  if (res.error) return { error: res.error }
  await writeAudit({ actor: gate.userId!, action: 'application.auto_accept', entityType: 'site_switch', entityId: 'auto_accept_applications', detail: { on } })
  revalidatePath(PATH)
  return { ok: true }
}

export async function declineApplication(applicationId: string, note?: string): Promise<{ ok?: true; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  const admin = createAdminClient() as any
  const { data: app } = await admin.from('application').select('id, status').eq('id', applicationId).maybeSingle()
  if (!app) return { error: 'Application not found' }
  if (app.status !== 'new') return { error: `Already ${app.status}` }
  const { error } = await admin.from('application').update({
    status: 'declined', reviewed_at: new Date().toISOString(), review_note: note?.trim() || null,
  }).eq('id', applicationId)
  if (error && /does not exist|schema cache|not find/i.test(error.message)) {
    return { error: 'RUN MIGRATION 0103_application_review.sql FIRST (npm run migrate)' }
  }
  if (error) return { error: error.message }
  await writeAudit({ actor: gate.userId!, action: 'application.decline', entityType: 'application', entityId: applicationId, detail: { note: note ?? null } })
  revalidatePath(PATH)
  return { ok: true }
}

/** A declined application back to NEW, for a change of heart. Accepted ones stay accepted: she is a member now. */
export async function reopenApplication(applicationId: string): Promise<{ ok?: true; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  const admin = createAdminClient() as any
  const { data: app } = await admin.from('application').select('id, status').eq('id', applicationId).maybeSingle()
  if (!app) return { error: 'Application not found' }
  if (app.status !== 'declined') return { error: `Cannot reopen an application that is ${app.status}` }
  const { error } = await admin.from('application').update({ status: 'new', reviewed_at: null, review_note: null }).eq('id', applicationId)
  if (error) return { error: error.message }
  await writeAudit({ actor: gate.userId!, action: 'application.reopen', entityType: 'application', entityId: applicationId })
  revalidatePath(PATH)
  return { ok: true }
}

/** A fresh /join link and the invitation again, for an accepted member who has not made her login yet. */
export async function resendInvitation(applicationId: string): Promise<{ ok?: true; inviteUrl?: string; emailed?: boolean; emailError?: string; error?: string }> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  const admin = createAdminClient() as any
  const { data: app } = await admin.from('application').select('*').eq('id', applicationId).maybeSingle()
  const a = app as ApplicationRow | null
  if (!a) return { error: 'Application not found' }
  if (a.status !== 'accepted' || !a.member_id) return { error: 'Only an accepted application can be re-invited' }
  const { data: member } = await admin.from('pilot_member').select('member_id, name, auth_user_id').eq('member_id', a.member_id).maybeSingle()
  if (!member) return { error: 'Her member record is gone; accept her again from a new application' }
  if (member.auth_user_id) return { error: `${member.name} already has a login; she signs in at /signin` }
  const inviteUrl = inviteUrlFor(member.member_id, member.name)
  const sent = await sendInvitationEmail(a.email, member.name, inviteUrl)
  await admin.from('application').update({
    invite_url: inviteUrl,
    emailed_at: sent.sent ? new Date().toISOString() : a.emailed_at,
    review_note: sent.sent ? null : `Invitation email failed: ${sent.error ?? 'unknown'}`,
  }).eq('id', applicationId)
  await writeAudit({ actor: gate.userId!, action: 'application.resend_invitation', entityType: 'application', entityId: applicationId, detail: { emailed: sent.sent, days: INVITE_DAYS } })
  revalidatePath(PATH)
  return { ok: true, inviteUrl, emailed: sent.sent, emailError: sent.error }
}

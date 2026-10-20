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
import { createMember } from '@/app/admin/private-stylist/actions'
import { loadBrandGraph } from '@/lib/brand-affinity'
import type { RankedBrand } from '@/lib/pilot-stylist'
import { splitBrandNames, sortBrandNames } from './brand-names'
import { mintShortInvite, INVITE_DAYS } from '@/lib/member-invite'
import { siteUrl } from '@/lib/studio/email'
import { sendInvitationEmail } from '@/lib/studio/invitation-email'

const PATH = '/admin/applications'

export interface ApplicationRow {
  id: string
  name: string | null
  email: string
  brands: string | null
  price_range: string | null
  style_inspiration: string | null
  note: string | null
  status: 'new' | 'accepted' | 'declined' | string
  created_at: string
  reviewed_at: string | null
  review_note: string | null
  member_id: string | null
  invite_url: string | null
  emailed_at: string | null
}

function inviteUrlFor(memberId: string, name: string): string {
  return `${siteUrl('')}/join/${mintShortInvite(memberId, name)}`
}

function notesFrom(a: ApplicationRow): string {
  const lines: string[] = []
  if (a.price_range) lines.push(`Shops around: ${a.price_range}`)
  if (a.style_inspiration) lines.push(`Style inspiration: ${a.style_inspiration}`)
  if (a.note) lines.push(`In her own words: ${a.note}`)
  lines.push(`Applied ${new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`)
  return lines.join('\n')
}

export interface AcceptResult {
  ok?: true
  memberId?: string
  memberName?: string
  /** True when the member already existed (same email) and was reused rather than made again. */
  reused?: boolean
  /** She already has a login: nothing to invite her to, so no email was sent. */
  alreadyIn?: boolean
  inviteUrl?: string
  emailed?: boolean
  emailError?: string
  matched?: string[]
  unmatched?: string[]
  error?: string
}

export async function acceptApplication(applicationId: string): Promise<AcceptResult> {
  const gate = await requireAdminUser()
  if (!gate.ok) return { error: 'Not authorised' }
  const admin = createAdminClient() as any

  const { data: app, error: aErr } = await admin.from('application').select('*').eq('id', applicationId).maybeSingle()
  if (aErr) return { error: aErr.message }
  const a = app as ApplicationRow | null
  if (!a) return { error: 'Application not found' }
  if (a.status !== 'new') return { error: `Already ${a.status}` }

  const email = a.email.trim().toLowerCase()
  const name = (a.name ?? '').trim() || email.split('@')[0]

  // Her brands: the ones MYRA knows are ranked in the order she wrote them;
  // the rest stay as her own words so nothing she said is lost.
  const names = splitBrandNames(a.brands)
  let matched: string[] = []
  let unmatched: string[] = names
  try {
    const sorted = sortBrandNames(await loadBrandGraph(admin), names)
    matched = sorted.matched
    unmatched = sorted.unmatched
  } catch { /* brand table unreachable: everything stays as her words */ }
  const brands: RankedBrand[] = matched.map((n, i) => ({ name: n, rank: i + 1 }))

  // One door email, one member. If she is already on the books, reuse her
  // record rather than make a twin; if she already has a login there is
  // nothing to invite her to.
  const { data: byDoor } = await admin.from('pilot_member').select('member_id, name, auth_user_id').ilike('invite_email', email).limit(1)
  const { data: byLogin } = byDoor?.length ? { data: [] } : await admin.from('pilot_member').select('member_id, name, auth_user_id').ilike('email', email).limit(1)
  const existing = byDoor?.length ? byDoor : byLogin
  let memberId: string
  let memberName = name
  let reused = false
  if (existing?.length) {
    memberId = existing[0].member_id
    memberName = existing[0].name ?? name
    reused = true
    if (existing[0].auth_user_id) {
      await admin.from('application').update({
        status: 'accepted', reviewed_at: new Date().toISOString(), member_id: memberId,
        review_note: 'Already a member with a login; no invitation needed.',
      }).eq('id', applicationId)
      await writeAudit({ actor: gate.userId!, action: 'application.accept', entityType: 'application', entityId: applicationId, detail: { memberId, reused, alreadyIn: true } })
      revalidatePath(PATH)
      return { ok: true, memberId, memberName, reused, alreadyIn: true, matched, unmatched }
    }
  } else {
    const made = await createMember({
      name,
      brands,
      brands_input_only: unmatched,
      occasions: {},
      work_dress_code: null,
      notes: notesFrom(a),
    })
    if (!made.member_id) return { error: made.error ?? 'Could not create her member record' }
    memberId = made.member_id
    const { error: doorErr } = await admin.from('pilot_member').update({ invite_email: email }).eq('member_id', memberId)
    if (doorErr && /does not exist|schema cache|not find/i.test(doorErr.message)) {
      return { error: 'RUN MIGRATION 0102_invite_email_sign_in.sql FIRST (npm run migrate)' }
    }
  }

  const inviteUrl = inviteUrlFor(memberId, memberName)
  const sent = await sendInvitationEmail(email, memberName, inviteUrl)

  const { error: uErr } = await admin.from('application').update({
    status: 'accepted',
    reviewed_at: new Date().toISOString(),
    member_id: memberId,
    invite_url: inviteUrl,
    emailed_at: sent.sent ? new Date().toISOString() : null,
    review_note: sent.sent ? null : `Invitation email failed: ${sent.error ?? 'unknown'}`,
  }).eq('id', applicationId)
  if (uErr && /does not exist|schema cache|not find/i.test(uErr.message)) {
    return { error: 'RUN MIGRATION 0103_application_review.sql FIRST (npm run migrate)' }
  }
  if (uErr) return { error: uErr.message }

  await writeAudit({ actor: gate.userId!, action: 'application.accept', entityType: 'application', entityId: applicationId, detail: { memberId, reused, emailed: sent.sent, matched, unmatched } })
  revalidatePath(PATH)
  revalidatePath('/admin/private-stylist')
  return { ok: true, memberId, memberName, reused, inviteUrl, emailed: sent.sent, emailError: sent.error, matched, unmatched }
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

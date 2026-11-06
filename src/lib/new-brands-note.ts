// THE WEEK'S NEW BRANDS — drafted Saturday night, read by Chloe Sunday morning,
// sent when she presses SEND (Chloe's ask, 2026-11-06: "at the end of the
// weekend send a notification in the app to users on new brands added this
// week — I will read it Sunday morning to be sent off. And an email.").
//
// "New this week" = brands filed into the brand picker in the last seven days
// (brand.picker_group_at — lib/picker-placement), not 'none'. Those are the
// brands a member can now pick in YOU, which is where the note sends her.
//
// Each member is told only about the brands she has not already loved or
// marked Not for me. One with nothing left is not told.

import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'
import { brandKey } from '@/lib/brand-affinity'
import { notifyMember } from '@/lib/push/notify'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from '@/lib/studio/email'

export interface NoteBrand {
  brand_id: string
  name: string
  group: string
  group_name: string
  /** How many pieces MYRA holds from it, when drafted. */
  pieces?: number
}

export interface NewBrandsNote {
  note_id: string
  week_of: string
  brands: NoteBrand[]
  title: string
  body: string
  email_intro: string
  status: 'draft' | 'sent' | 'skipped'
  created_at: string
  updated_at: string
  sent_at: string | null
  sent_report: Record<string, unknown> | null
}

/** Where the note opens: YOU, where her brands are. */
export const NEW_BRANDS_PATH = '/me/profile'

const GROUP_NAMES = new Map(BRAND_GROUPS.map((g) => [g.key, g.name]))

/** The Saturday a week ends on, as a UTC date — the note's key. */
export function weekOf(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  // Monday to Saturday look ahead to this Saturday; Sunday morning — when
  // Chloe reads it — still belongs to the week that ended yesterday.
  const day = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -1 : 6 - day))
  return d.toISOString().slice(0, 10)
}

export async function brandsFiledSince(admin: any, sinceIso: string): Promise<NoteBrand[]> {
  const { data, error } = await admin
    .from('brand')
    .select('brand_id, name, picker_group, vector_item_count')
    .eq('status', 'stocked')
    .not('picker_group', 'is', null)
    .neq('picker_group', 'none')
    .gte('picker_group_at', sinceIso)
    .order('name')
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((b) => ({
    brand_id: b.brand_id,
    name: b.name,
    group: b.picker_group,
    group_name: GROUP_NAMES.get(b.picker_group) ?? b.picker_group,
    pieces: Number(b.vector_item_count ?? 0),
  }))
}

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

export function defaultWording(brands: NoteBrand[]): { title: string; body: string; email_intro: string } {
  const n = brands.length
  // Lead with the biggest labels (most pieces) — the ones she is likeliest to know.
  const top = [...brands].sort((a, b) => (b.pieces ?? 0) - (a.pieces ?? 0)).map((b) => b.name)
  const lead = n > 3 ? `${top.slice(0, 3).join(', ')} and ${n - 3} more` : listNames(top)
  return {
    title: n === 1 ? 'A new brand on MYRA' : `${n} new brands on MYRA`,
    body: `New this week: ${lead}. Tap to add the ones you love.`,
    email_intro: `This week MYRA started stocking ${n === 1 ? 'a new brand' : `${n} new brands`}. Add the ones you love in YOU, and MYRA will start styling you in them.`,
  }
}

/** Draft this week's note, or return the one already there. Null when nothing is new. */
export async function draftNewBrandsNote(admin: any, now = new Date()): Promise<{ note: NewBrandsNote | null; created: boolean }> {
  const week = weekOf(now)
  const { data: existing } = await admin.from('new_brands_note').select('*').eq('week_of', week).maybeSingle()
  if (existing) return { note: existing as NewBrandsNote, created: false }
  const since = new Date(new Date(`${week}T23:59:59Z`).getTime() - 7 * 24 * 3600_000).toISOString()
  const brands = await brandsFiledSince(admin, since)
  if (!brands.length) return { note: null, created: false }
  const { data, error } = await admin
    .from('new_brands_note')
    .insert({ week_of: week, brands, ...defaultWording(brands) })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { note: data as NewBrandsNote, created: true }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function noteEmailHtml(note: Pick<NewBrandsNote, 'title' | 'email_intro'>, brands: NoteBrand[], firstName: string): string {
  const byGroup = new Map<string, string[]>()
  for (const b of brands) byGroup.set(b.group_name, [...(byGroup.get(b.group_name) ?? []), b.name])
  const groups = Array.from(byGroup.entries()).map(([g, names]) =>
    `<p style="margin:0 0 14px 0;"><span style="font-size:11px;letter-spacing:0.08em;color:#a8a8a4;text-transform:uppercase;">${esc(g)}</span><br/><span style="font-size:15px;color:#2b2b2b;">${names.map(esc).join(' · ')}</span></p>`).join('')
  const body = `
<p style="margin:0 0 16px 0;font-size:15px;">${firstName ? `Hi ${esc(firstName)},` : 'Hello,'}</p>
<p style="margin:0 0 20px 0;font-size:15px;">${esc(note.email_intro)}</p>
${groups}
<p style="margin:24px 0 0 0;">${emailButton(siteUrl(NEW_BRANDS_PATH), 'Add your brands')}</p>`
  return emailShell(note.title, body, 'MYRA · YOUR PRIVATE STYLIST')
}

/**
 * Send to every real member (or, with testTo, a sample to that address only —
 * nothing is marked and no member is told).
 */
export async function sendNewBrandsNote(admin: any, note: NewBrandsNote, opts: { testTo?: string } = {}): Promise<Record<string, unknown>> {
  if (!note.brands.length) return { error: 'No brands left in this note' }

  if (opts.testTo) {
    const res = await sendStudioEmail({
      kind: 'shopper_new_brands', subject: note.title, to: opts.testTo,
      html: noteEmailHtml(note, note.brands, 'Chloe'), meta: { noteId: note.note_id, sample: true },
    })
    return { test: true, emailed: res.sent, error: res.error }
  }

  const { data: members, error } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id, brands, brands_never')
    .eq('is_synthetic', false).not('auth_user_id', 'is', null)
  if (error) return { error: error.message }

  const report: Record<string, unknown>[] = []
  let told = 0, pushed = 0, emailed = 0
  for (const m of (members ?? []) as any[]) {
    const entry: Record<string, unknown> = { member: m.name ?? m.member_id }
    report.push(entry)
    const hers = new Set([
      ...((m.brands ?? []) as any[]).map((b) => brandKey(typeof b === 'string' ? b : b?.name ?? '')),
      ...((m.brands_never ?? []) as string[]).map(brandKey),
    ])
    const fresh = note.brands.filter((b) => !hers.has(brandKey(b.name)))
    entry.brands = fresh.length
    if (!fresh.length) { entry.skipped = 'has them all'; continue }
    try {
      // Chloe's words go to everyone as she approved them; only the email's
      // brand list is cut to what is new to this member.
      const wording = note
      const res = await notifyMember(admin,
        { memberId: m.member_id, kind: 'note', body: wording.body },
        { title: wording.title, url: NEW_BRANDS_PATH, collapseId: 'new-brands' })
      if (res.noted) told++
      if (res.push?.sent) pushed++
      entry.push = res.push?.sent ?? 0

      let email: string | null = null
      try { email = (await admin.auth.admin.getUserById(m.auth_user_id)).data?.user?.email ?? null } catch { /* no address */ }
      if (email) {
        const firstName = (m.name ?? '').trim().split(/\s+/)[0] ?? ''
        const sent = await sendStudioEmail({
          kind: 'shopper_new_brands', subject: wording.title, to: email,
          html: noteEmailHtml(wording, fresh, firstName), meta: { memberId: m.member_id, noteId: note.note_id },
        })
        entry.emailed = sent.sent
        if (sent.error) entry.emailError = sent.error
        if (sent.sent) emailed++
      } else entry.emailed = 'no address'
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
  }
  return { members: (members ?? []).length, told, pushed, emailed, report }
}

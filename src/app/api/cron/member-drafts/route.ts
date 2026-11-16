// MEMBER DRAFTS — the two one-off member emails Chloe reads before they go
// (2026-11-15): BRANDS TO DISCOVER (lib/studio/brand-discovery) and PARTY
// SEASON looks (lib/studio/party-looks). Not on a schedule: nothing goes
// unless the call says send=1, and party looks are composed only on compose=1.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/member-drafts?kind=brands&dry=1"
//
//   ?kind=brands|party   which email (required)
//   ?member=<id>         one member only
//   ?compose=1           party only: compose her looks if she has none this season (30–90s a member)
//   ?dry=1               gather, send nothing, report what would go
//   ?preview=1           return that member's email as HTML, send nothing
//   ?to=a@b.c            a TRIAL to this address instead of hers (party looks stay unpublished)
//   ?send=1              the real send: party looks published first, then the email
//   ?force=1             send even if she had this email in the last six days
//   ?site=http://localhost:3000   preview/trial only: links open here

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendStudioEmail, type EmailKind } from '@/lib/studio/email'
import { gatherBrandDiscovery, discoveryHtml, discoverySubject, noDiscovery, type DiscoveryMember } from '@/lib/studio/brand-discovery'
import { ensurePartyLooks, gatherPartyLooks, partyHtml, partySubject, publishPartyLooks } from '@/lib/studio/party-looks'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

const html = (body: string) => new NextResponse(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const q = req.nextUrl.searchParams
  const kind = q.get('kind')
  if (kind !== 'brands' && kind !== 'party') return NextResponse.json({ error: 'kind=brands or kind=party' }, { status: 400 })
  const dry = q.get('dry') === '1'
  const preview = q.get('preview') === '1'
  const compose = q.get('compose') === '1'
  const force = q.get('force') === '1'
  const send = q.get('send') === '1'
  const toOverride = q.get('to')
  const site = (preview || toOverride) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q.get('site') ?? '') ? q.get('site')! : undefined
  const sending = !dry && !preview && (!!toOverride || send)
  const emailKind: EmailKind = kind === 'brands' ? 'shopper_brand_discovery' : 'shopper_party_looks'
  const admin = createAdminClient() as any

  let members = admin.from('pilot_member')
    .select('member_id, name, auth_user_id, brands, brands_input_only, brands_never')
    .eq('is_synthetic', false).not('auth_user_id', 'is', null).order('name')
  if (q.get('member')) members = members.eq('member_id', q.get('member'))
  const { data: rows, error } = await members
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 3600_000).toISOString()
  const report: Record<string, unknown>[] = []
  let sent = 0
  for (const m of (rows ?? []) as DiscoveryMember[]) {
    const entry: Record<string, unknown> = { member: m.name ?? m.member_id }
    report.push(entry)
    try {
      let subject = ''
      let body = ''
      let publish: (() => Promise<number>) | null = null
      if (kind === 'brands') {
        const d = await gatherBrandDiscovery(admin, m)
        entry.brands = d.brands.map((b) => `${b.name} (${b.pieces.length})`)
        entry.considered = d.considered
        if (noDiscovery(d)) { entry.sent = false; entry.skipped = 'no neighbour stocks three pieces for her'; continue }
        subject = discoverySubject(d); body = discoveryHtml(m, d, site)
      } else {
        if (compose) {
          const made = await ensurePartyLooks(admin, m.member_id, { compose: true })
          entry.composed = made.composed ?? 0; entry.dropped = made.dropped ?? 0
          if (made.error) entry.composeError = made.error
        }
        const pl = await gatherPartyLooks(admin, m)
        entry.looks = pl.looks.length; entry.status = pl.status
        if (!pl.looks.length) { entry.sent = false; entry.skipped = pl.delivery_id ? 'no look passed' : 'not composed yet (compose=1)'; continue }
        subject = partySubject(pl); body = partyHtml(m, pl, site)
        const deliveryId = pl.delivery_id!
        const lookIds = pl.looks.map((l) => l.look_id)
        publish = () => publishPartyLooks(admin, deliveryId, m.member_id, lookIds)
      }
      entry.subject = subject
      if (preview) return html(body)
      if (!sending) { entry.sent = false; continue }
      let email: string | null = toOverride
      if (!email) { try { email = (await admin.auth.admin.getUserById(m.auth_user_id!)).data?.user?.email ?? null } catch { /* no address, no note */ } }
      if (!email) { entry.sent = false; entry.skipped = 'no email address'; continue }
      if (!toOverride && !force) {
        const { data: recent } = await admin.from('email_log').select('id').eq('kind', emailKind)
          .gte('sent_at', sixDaysAgo).contains('meta', { memberId: m.member_id }).limit(1)
        if (recent?.length) { entry.sent = false; entry.skipped = 'sent this week'; continue }
      }
      if (!toOverride && publish) entry.published = await publish()
      const res = await sendStudioEmail({ kind: emailKind, subject, html: body, to: email, meta: { memberId: m.member_id, trial: !!toOverride, site: site ?? null } })
      entry.sent = res.sent
      if (res.error) entry.error = res.error
      if (res.sent) sent++
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
  }
  if (preview) return html('<p style="font-family:Helvetica,Arial,sans-serif">Nothing to show this member — no email would go.</p>')
  return NextResponse.json({ kind, members: (rows ?? []).length, dry, sent, report })
}

// THE WEEK'S NEW BRANDS — the Saturday-night draft (Vercel cron; see vercel.json).
//
// Drafts the note from the brands filed into the brand picker this week
// (lib/new-brands-note) and emails Chloe that it is waiting. Nothing goes to
// members from here: she reads it on /admin/new-brands on Sunday morning and
// presses SEND. Nothing new this week, nothing drafted.
//
//   Saturday 20:00 UTC.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/new-brands-note"

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { draftNewBrandsNote } from '@/lib/new-brands-note'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from '@/lib/studio/email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const admin = createAdminClient() as any
  try {
    const { note, created } = await draftNewBrandsNote(admin)
    if (!note) return NextResponse.json({ drafted: false, reason: 'no new brands this week' })
    let told: boolean | string = false
    if (created) {
      const names = note.brands.map((b) => b.name).join(' · ')
      const res = await sendStudioEmail({
        kind: 'new_brands_draft',
        subject: `MYRA new brands — ${note.brands.length} to send this week`,
        html: emailShell('New brands, ready for you', `
<p style="margin:0 0 14px 0;">This week’s note to members is drafted. Read it, change anything, and press SEND when you’re happy. Nothing goes out until you do.</p>
<p style="margin:0 0 18px 0;color:#2b2b2b;">${names}</p>
<p style="margin:0;">${emailButton(siteUrl('/admin/new-brands'), 'Read the note')}</p>`),
        meta: { noteId: note.note_id },
      })
      told = res.sent || (res.error ?? false)
    }
    return NextResponse.json({ drafted: created, week: note.week_of, brands: note.brands.length, status: note.status, toldChloe: told })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

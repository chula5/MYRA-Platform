// SAVE A SCREENSHOT — the door from FOR YOU and the SAVED shelf.
//
// A route rather than a server action: finding the piece can mean a web
// search, a shop's own search and the eye holding pictures side by side —
// 40 seconds on a slow day — and the member pages' actions stop at 60. The
// member is resolved on the server (her session, or the member Chloe names
// from HER VIEW, admin only); the work is in lib/screenshot-save.

import { NextResponse, type NextRequest } from 'next/server'
import { resolveClientMember } from '@/lib/client-member'
import { saveFromScreenshot, MAX_SCREENSHOT_BYTES } from '@/lib/screenshot-save'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  let fd: FormData
  try { fd = await req.formData() } catch { return NextResponse.json({ error: 'Choose a screenshot first' }, { status: 400 }) }
  const me = await resolveClientMember(String(fd.get('member') ?? '') || undefined)
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Choose a screenshot first' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'That is not a picture' }, { status: 400 })
  if (file.size > MAX_SCREENSHOT_BYTES) return NextResponse.json({ error: 'That picture is too big — a plain screenshot is plenty' }, { status: 413 })
  const bytes = Buffer.from(await file.arrayBuffer())
  try {
    return NextResponse.json(await saveFromScreenshot(me, bytes, file.type))
  } catch (err) {
    console.error('[api/me/screenshot]', err)
    return NextResponse.json({ error: 'MYRA could not keep that — try again' }, { status: 500 })
  }
}

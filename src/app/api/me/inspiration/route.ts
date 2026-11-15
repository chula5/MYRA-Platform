// INSPIRATION TO OUTFIT — the door on her Looks page.
//
// POST a picture of a look: MYRA reads it now (a few seconds) and styles
// outfits around it in the background; GET ?id= says how far that got, and
// GET alone lists her recent inspirations. A route rather than a server
// action, like the screenshot door: the read holds the picture against the
// eye, and the member is resolved on the server (her session, or the member
// Chloe names from HER VIEW, admin only).

import { NextResponse, type NextRequest } from 'next/server'
import { resolveClientMember } from '@/lib/client-member'
import { MAX_SCREENSHOT_BYTES } from '@/lib/screenshot-save'
import { startMemberInspiration, memberInspirationStatus, listMemberInspirations } from '@/lib/member-inspiration'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  let fd: FormData
  try { fd = await req.formData() } catch { return NextResponse.json({ error: 'Choose a picture first' }, { status: 400 }) }
  const me = await resolveClientMember(String(fd.get('member') ?? '') || undefined)
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const file = fd.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Choose a picture first' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'That is not a picture' }, { status: 400 })
  if (file.size > MAX_SCREENSHOT_BYTES) return NextResponse.json({ error: 'That picture is too big — a plain screenshot is plenty' }, { status: 413 })
  try {
    const r = await startMemberInspiration(me.memberId, Buffer.from(await file.arrayBuffer()), file.type)
    return NextResponse.json(r, { status: r.error ? 422 : 200 })
  } catch (err) {
    console.error('[api/me/inspiration]', err)
    return NextResponse.json({ error: 'MYRA could not read that picture — try again' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const me = await resolveClientMember(req.nextUrl.searchParams.get('member') || undefined)
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (id) return NextResponse.json(await memberInspirationStatus(me.memberId, id))
  return NextResponse.json({ inspirations: await listMemberInspirations(me.memberId) })
}

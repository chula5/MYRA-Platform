// Outfit Review projects — list and create, as ROUTE HANDLERS (not server
// actions): the page polls this while projects compose, and a screenshot's
// read + product hunt can take 40s, which a server action would queue every
// other click behind. Admin only.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-request'
import { createReviewProject, listReviewProjects, type ProjectKind } from '@/lib/review-projects'
import { intakeScreenshot } from '@/lib/review-screenshot'
import { intakeInspiration, type ProjectInspiration } from '@/lib/review-inspiration'
import { MAX_SCREENSHOT_BYTES } from '@/lib/screenshot-save'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ projects: [], error: 'Not authorised' }, { status: 401 })
  return NextResponse.json(await listReviewProjects())
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Not authorised' }, { status: 401 })
  let fd: FormData
  try { fd = await req.formData() } catch { return NextResponse.json({ error: 'Nothing to make a project from' }, { status: 400 }) }
  const brief = String(fd.get('brief') ?? '').trim()
  const kind = (String(fd.get('kind') ?? 'looks') === 'three_ways' ? 'three_ways' : 'looks') as ProjectKind
  const anchors = Number(fd.get('anchors')) || 20
  const file = fd.get('file')

  // The picture is ONE PIECE to build around (the default), or a WHOLE LOOK to compose in the style of.
  const asLook = String(fd.get('picture') ?? '') === 'look'
  let anchor = null
  let inspiration: ProjectInspiration | null = null
  let intake: { read?: string | null; how?: string; message?: string } | null = null
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'That is not a picture' }, { status: 400 })
    if (file.size > MAX_SCREENSHOT_BYTES) return NextResponse.json({ error: 'That picture is too big — a plain screenshot is plenty' }, { status: 413 })
    if (asLook) {
      let look: Awaited<ReturnType<typeof intakeInspiration>>
      try {
        look = await intakeInspiration(Buffer.from(await file.arrayBuffer()), file.type)
      } catch (err) {
        console.error('[api/admin/review-projects] look', err)
        return NextResponse.json({ error: 'MYRA could not read that picture — try again' }, { status: 500 })
      }
      if (look.error || !look.inspiration) return NextResponse.json({ error: look.error ?? 'Could not read that look', read: look.read ?? null }, { status: 422 })
      inspiration = look.inspiration
      intake = { read: look.read, how: 'look', message: look.message }
    } else {
    let piece: Awaited<ReturnType<typeof intakeScreenshot>>
    try {
      piece = await intakeScreenshot(Buffer.from(await file.arrayBuffer()), file.type)
    } catch (err) {
      console.error('[api/admin/review-projects] screenshot', err)
      return NextResponse.json({ error: 'MYRA could not read that screenshot — try again' }, { status: 500 })
    }
    if (piece.error || !piece.anchor) return NextResponse.json({ error: piece.error ?? 'Could not place that piece', read: piece.read ?? null }, { status: 422 })
    anchor = piece.anchor
    intake = piece
    }
  }
  const res = await createReviewProject({ brief: brief || null, kind, anchor, inspiration, targetAnchors: anchors })
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ project: res.project, intake: intake ? { read: intake.read, how: intake.how, message: intake.message } : null })
}

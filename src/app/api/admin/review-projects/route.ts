// Outfit Review projects — list and create, as ROUTE HANDLERS (not server
// actions): the page polls this while projects compose, and a screenshot's
// read + product hunt can take 40s, which a server action would queue every
// other click behind. Admin only.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-request'
import { createReviewProject, listReviewProjects, type ProjectKind } from '@/lib/review-projects'
import { intakeScreenshot } from '@/lib/review-screenshot'
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

  let anchor = null
  let intake: Awaited<ReturnType<typeof intakeScreenshot>> | null = null
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'That is not a picture' }, { status: 400 })
    if (file.size > MAX_SCREENSHOT_BYTES) return NextResponse.json({ error: 'That picture is too big — a plain screenshot is plenty' }, { status: 413 })
    try {
      intake = await intakeScreenshot(Buffer.from(await file.arrayBuffer()), file.type)
    } catch (err) {
      console.error('[api/admin/review-projects] screenshot', err)
      return NextResponse.json({ error: 'MYRA could not read that screenshot — try again' }, { status: 500 })
    }
    if (intake.error || !intake.anchor) return NextResponse.json({ error: intake.error ?? 'Could not place that piece', read: intake.read ?? null }, { status: 422 })
    anchor = intake.anchor
  }
  const res = await createReviewProject({ brief: brief || null, kind, anchor, targetAnchors: anchors })
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ project: res.project, intake: intake ? { read: intake.read, how: intake.how, message: intake.message } : null })
}

// One Outfit Review project: its looks (polled while it composes and shoots),
// and the decisions on them — pick (→ draft outfit + Higgsfield shoot), skip,
// restore, edit (swap / remove), reshoot; pause, resume, delete the project.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-request'
import {
  getReviewProject, pickReviewLook, skipReviewLook, restoreReviewLook, editReviewLook, reshootReviewLook,
  setReviewProjectStatus, deleteReviewProject,
} from '@/lib/review-projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) return NextResponse.json({ looks: [], error: 'Not authorised' }, { status: 401 })
  const { id } = await ctx.params
  return NextResponse.json(await getReviewProject(id))
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Not authorised' }, { status: 401 })
  const { id } = await ctx.params
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const action = String(body?.action ?? '')
  const lookId = typeof body?.lookId === 'string' ? body.lookId : ''
  switch (action) {
    case 'pick': return NextResponse.json(await pickReviewLook(lookId))
    case 'skip': return NextResponse.json(await skipReviewLook(lookId))
    case 'restore': return NextResponse.json(await restoreReviewLook(lookId))
    case 'edit': return NextResponse.json(await editReviewLook(lookId, Array.isArray(body?.items) ? body.items : []))
    case 'reshoot': return NextResponse.json(await reshootReviewLook(lookId))
    case 'pause': return NextResponse.json(await setReviewProjectStatus(id, 'paused'))
    case 'resume': return NextResponse.json(await setReviewProjectStatus(id, 'queued'))
    case 'delete': return NextResponse.json(await deleteReviewProject(id))
    default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

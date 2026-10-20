// HER LOOKS — make the pictures (LOCAL ONLY; not in vercel.json).
//
// The Higgsfield CLI lives on Chloe's Mac, so this is opened there and shoots
// her looks that have no picture yet (lib/look-shoot) — Chloe's own unless
// STYLED_WAYS_RENDER_MEMBERS=all. On Vercel it answers at once with `skipped`.
//
//     open "http://localhost:3000/api/cron/looks-render?limit=6"
//
//   ?limit=6        how many pictures to make this run (each is a minute or two)
//   ?member=<id>    one member instead of the default
//   ?look=<id>      exactly one look

import { NextRequest, NextResponse } from 'next/server'
import { renderMemberLooks } from '@/lib/look-shoot'
import { higgsfieldShootForLook } from '@/app/admin/private-stylist/actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const q = req.nextUrl.searchParams
  const look = q.get('look')
  if (look) return NextResponse.json(await higgsfieldShootForLook(look, 'E5', { light: true }))
  const limit = Math.max(1, Math.min(40, Number(q.get('limit') ?? 6) || 6))
  const budgetMs = Math.max(60_000, Math.min(60 * 60_000, Number(q.get('budget') ?? 280_000) || 280_000))
  return NextResponse.json(await renderMemberLooks({ memberId: q.get('member') ?? undefined, limit, budgetMs }))
}

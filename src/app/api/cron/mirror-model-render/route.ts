// MIRROR — SEE ON A MODEL pictures for asks that found no renderer (not in vercel.json).
//
// A member on the live site asks the Mirror to see a piece on a model; Vercel
// has no Higgsfield CLI, so the ask waits in mirror_model_shot. This is opened
// on Chloe's Mac, where the CLI is logged in, and makes the pictures oldest
// first. On Vercel it answers at once with `skipped`.
//
//     open "http://localhost:3000/api/cron/mirror-model-render?limit=6"
//
//   ?limit=6     how many pictures to make this run (each is a minute or two)
//   ?item=<id>   exactly one piece

import { NextRequest, NextResponse } from 'next/server'
import { drainModelShots, renderModelShot } from '@/lib/mirror/model-shot'

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
  const item = q.get('item')
  if (item) return NextResponse.json(await renderModelShot(item))
  const limit = Math.max(1, Math.min(40, Number(q.get('limit') ?? 6) || 6))
  const budgetMs = Math.max(60_000, Math.min(60 * 60_000, Number(q.get('budget') ?? 280_000) || 280_000))
  return NextResponse.json(await drainModelShots({ limit, budgetMs }))
}

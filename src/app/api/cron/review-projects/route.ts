// Outfit Review projects — the drain (lib/review-projects).
//
//     open http://localhost:3000/api/cron/review-projects
//
// ?kick=1 is a tap (kickReviewProjectsDrain) borrowing this function's 300s
// on Vercel; the cron sweep recovers runs that were cut off and finishes
// anything still queued.

import { NextRequest, NextResponse } from 'next/server'
import { drainReviewProjects } from '@/lib/review-projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const kicked = req.nextUrl.searchParams.get('kick') === '1'
  const result = await drainReviewProjects(240_000)
  if (kicked) console.log('[review-projects] kicked drain', JSON.stringify(result))
  return NextResponse.json({ kicked, ...result })
}

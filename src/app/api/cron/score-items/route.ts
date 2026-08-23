// Item scoring cron — nightly (see vercel.json).
//
// Brand Watch inserts a kept piece with the feed's facts only: type, colour,
// material, price. The style dimensions the composer actually ranks on — fit,
// structure, length, pattern — are read from the photograph, and nothing was
// doing that automatically. The library drifted to 24 scored items out of
// 2,389, and every shape preference a member had authored quietly matched
// nothing.
//
// This keeps the floor swept: whatever arrived today is scored tonight.
//
// Also callable manually:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/score-items

import { NextRequest, NextResponse } from 'next/server'
import { scoreUnscoredItems, countUnscored } from '@/app/admin/items/score-items'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// One run has 300 seconds. Batches of 40 at a concurrency of 8 take roughly a
// minute, so four rounds leave headroom — and a backlog simply drains over
// several nights rather than timing the function out.
const ROUNDS = 4
const BATCH = 40

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // no secret configured — allow (matches Vercel default)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })

  let scored = 0
  let skipped = 0
  let failed = 0
  let cursor: string | null = null
  const errors: string[] = []

  for (let i = 0; i < ROUNDS; i++) {
    const r = await scoreUnscoredItems(BATCH, 8, cursor)
    scored += r.scored
    skipped += r.skipped
    failed += r.failed
    errors.push(...r.errors)
    if (!r.looked || !r.nextCursor) break
    cursor = r.nextCursor
  }

  const { unscored, total } = await countUnscored()
  return NextResponse.json({
    scored, skipped, failed, remaining: unscored, library: total,
    errors: errors.slice(0, 5),
  })
}

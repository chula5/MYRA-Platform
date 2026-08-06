// Review digest cron — 7am and 12pm UK (see vercel.json; Vercel cron runs in
// UTC, so schedules are set for GMT and land an hour later during BST).
// The email is a doorbell, not a door: preview grid + one deep link, no
// actions inside. Suppressed when the queue is empty; email_log caps sends at
// 2 per day even if the cron misfires.

import { NextRequest, NextResponse } from 'next/server'
import { sendReviewDigest } from '@/lib/studio/digest'
import { processRenderQueue } from '@/lib/studio/render-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const result = await sendReviewDigest()
  // Piggyback: keep the render queue moving on every scheduled wake.
  const renders = await processRenderQueue(120_000)
  return NextResponse.json({ ...result, renders })
}

// Render-queue drainer — keeps the single sequential Higgsfield queue moving
// (retries, recovery after a crashed invocation). Approvals always process
// ahead of stock swaps.
//
// IMPORTANT — where you call this from matters. The Higgsfield shoot runs via
// the locally-authenticated Higgsfield CLI, which does NOT exist in Vercel's
// serverless bundle. On Vercel this route reports `skipped` and leaves every
// job queued and intact; the renders actually happen when you hit the SAME
// route on a machine where the CLI is logged in:
//
//     npm run dev          # with .env.local pointing at the same Supabase project
//     open http://localhost:3000/api/cron/render-queue
//
// Approved outfits publish to the live site as each render lands.
//
//   ?retryFailed=1   first re-queue jobs that previously failed (attempts reset)

import { NextRequest, NextResponse } from 'next/server'
import { processRenderQueue, requeueFailedRenders, rendererAvailable } from '@/lib/studio/render-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })

  const retried = req.nextUrl.searchParams.get('retryFailed') === '1'
    ? await requeueFailedRenders()
    : null

  const result = await processRenderQueue(240_000)
  return NextResponse.json({
    rendererAvailable: rendererAvailable(),
    ...(retried ? { requeuedFailed: retried.requeued } : {}),
    ...result,
  })
}

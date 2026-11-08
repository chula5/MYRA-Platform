// MEMBER AVATAR — drain the job queue. Scheduled every 5 minutes (vercel.json) and kicked
// from the app the moment a member starts or approves something, so she rarely waits for the
// schedule. Runs on Vercel: the models are reached over HTTPS, nothing local is needed.

import { NextRequest, NextResponse } from 'next/server'
import { drainAvatarQueue } from '@/lib/avatar/jobs'
import { avatarConfigured } from '@/lib/avatar/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const cfg = avatarConfigured()
  if (!cfg.ok) return NextResponse.json({ skipped: `avatar not configured: ${cfg.missing.join(', ')}` })
  const budget = Math.max(30_000, Math.min(280_000, Number(req.nextUrl.searchParams.get('budget') ?? 240_000) || 240_000))
  return NextResponse.json(await drainAvatarQueue(budget))
}

// WAYS TO WEAR IT — make the pictures (LOCAL ONLY; not in vercel.json).
//
// The Higgsfield CLI lives on Chloe's Mac, so this is opened there, after a
// sweep or a session of tapping, and makes pictures for kept ways that have
// none — Chloe's own ways unless STYLED_WAYS_RENDER_MEMBERS=all. On Vercel
// it answers at once with `skipped`.
//
//     open "http://localhost:3000/api/cron/styled-ways-render?limit=6"
//
//   ?limit=6        how many pictures to make this run (each is minutes)
//   ?member=<id>    one member instead of the default
//   ?way=<id>       exactly one kept way

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { renderStyledWays, shootStyledWay } from '@/lib/styled-ways-shoot'

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
  const way = q.get('way')
  if (way) {
    const r = await shootStyledWay(createAdminClient() as any, way)
    return NextResponse.json(r)
  }
  const limit = Math.max(1, Math.min(24, Number(q.get('limit') ?? 6) || 6))
  const r = await renderStyledWays({ memberId: q.get('member') ?? undefined, limit, budgetMs: 280_000 })
  return NextResponse.json(r)
}

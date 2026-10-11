import { NextRequest, NextResponse } from 'next/server'
import { loadQueuePage, type QueueFilters } from '@/app/admin/brand-watch/actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The Brand Watch queue, served as a ROUTE HANDLER (not a server action).
// Next.js runs a page's server actions one at a time, so a brand click waited
// behind whatever the page was already doing — the 20s refresh while a scan
// runs, the job poll, a keep — and showed nothing for seconds. A route handler
// is an ordinary concurrent request. loadQueuePage still runs its own
// assertAdmin, which throws for anyone else.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { offset?: number; brand?: string | null; filters?: QueueFilters }
    const page = await loadQueuePage(Number(body.offset ?? 0), body.brand || undefined, body.filters ?? {})
    return NextResponse.json(page)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: /Not authorised/.test(msg) ? 401 : 500 })
  }
}

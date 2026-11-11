import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-request'
import { getReviewSwapOptions, getReviewAddOptions } from '@/app/admin/outfit-review/actions'

export const dynamic = 'force-dynamic'

// Swap/add item search for the Outfit Review panel, served as a ROUTE HANDLER
// (not a server action). Next.js runs server actions sequentially, so while an
// approved outfit's Higgsfield shoot is generating (a long-running action), the
// swap search would otherwise be queued behind it and appear frozen. A route
// handler is a normal concurrent request, so search keeps working during shoots.
export async function GET(req: NextRequest) {
  // Admin gate — the /admin layout check, remembered per session (lib/admin-request).
  const t0 = Date.now()
  if (!(await isAdminRequest())) return NextResponse.json({ options: [] }, { status: 401 })
  const t1 = Date.now()
  // Server-Timing says where a slow search spent its time (DevTools → Network → Timing).
  const timed = (body: unknown) => NextResponse.json(body, { headers: { 'Server-Timing': `auth;dur=${t1 - t0}, work;dur=${Date.now() - t1}` } })

  const sp = req.nextUrl.searchParams
  const mode = sp.get('mode') ?? 'swap'
  const anchor = sp.get('anchor') ?? ''
  const query = sp.get('q') ?? ''
  const brand = sp.get('brand') ?? ''
  const exclude = (sp.get('exclude') ?? '').split(',').filter(Boolean)
  // The picker's colour and type chips — sent all along, never read until now.
  const filters = { colour: sp.get('colour') ?? '', itemType: sp.get('type') ?? '' }

  if (mode === 'add') {
    const present = (sp.get('present') ?? '').split(',').filter(Boolean)
    const res = await getReviewAddOptions(anchor, present, exclude, query, brand, filters)
    return timed(res)
  }

  const slot = sp.get('slot') ?? ''
  const res = await getReviewSwapOptions(anchor, slot, exclude, query, brand, filters)
  return timed(res)
}

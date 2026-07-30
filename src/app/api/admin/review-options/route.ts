import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getReviewSwapOptions, getReviewAddOptions } from '@/app/admin/outfit-review/actions'

export const dynamic = 'force-dynamic'

// Swap/add item search for the Outfit Review panel, served as a ROUTE HANDLER
// (not a server action). Next.js runs server actions sequentially, so while an
// approved outfit's Higgsfield shoot is generating (a long-running action), the
// swap search would otherwise be queued behind it and appear frozen. A route
// handler is a normal concurrent request, so search keeps working during shoots.
export async function GET(req: NextRequest) {
  // Admin gate — mirror the /admin layout check.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) {
    return NextResponse.json({ options: [] }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const mode = sp.get('mode') ?? 'swap'
  const anchor = sp.get('anchor') ?? ''
  const query = sp.get('q') ?? ''
  const brand = sp.get('brand') ?? ''
  const exclude = (sp.get('exclude') ?? '').split(',').filter(Boolean)

  if (mode === 'add') {
    const present = (sp.get('present') ?? '').split(',').filter(Boolean)
    const res = await getReviewAddOptions(anchor, present, exclude, query, brand)
    return NextResponse.json(res)
  }

  const slot = sp.get('slot') ?? ''
  const res = await getReviewSwapOptions(anchor, slot, exclude, query, brand)
  return NextResponse.json(res)
}

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { setOutfitsStatus } from '@/app/admin/projects/actions'

export const dynamic = 'force-dynamic'

// Set outfit status (draft/live/archived) via a ROUTE HANDLER, not a server
// action. Next runs server actions sequentially, so while a Refined Higgsfield
// shoot is generating (a long-running action) the DRAFT/LIVE toggle would be
// queued behind it and appear not to work. A route handler runs concurrently.
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const projectId = body?.projectId
  const outfitIds = body?.outfitIds
  const status = body?.status
  if (!projectId || !Array.isArray(outfitIds) || !status) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const res = await setOutfitsStatus(projectId, outfitIds, status)
  return NextResponse.json(res)
}

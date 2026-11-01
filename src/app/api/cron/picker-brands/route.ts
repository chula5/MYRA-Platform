// NEW BRANDS INTO THE BRAND PICKER (Vercel cron; see vercel.json).
//
// Daily, after the night's Brand Watch scans: every stocked brand with pieces
// that the onboarding / YOU picker does not name is filed into a group
// (lib/picker-placement), so new members are offered it.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/picker-brands?dry=1"
//
//   ?dry=1     file nothing, report what would be filed
//   ?limit=N   at most N brands this run (default 60)

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { placeNewBrands } from '@/lib/picker-placement'

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
  const dry = q.get('dry') === '1'
  const limit = Number(q.get('limit')) || undefined
  try {
    const result = await placeNewBrands(createAdminClient() as any, { dry, limit })
    if (!dry && result.placed.length) {
      revalidatePath('/me/welcome')
      revalidatePath('/me/profile')
    }
    return NextResponse.json({ dry, ...result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

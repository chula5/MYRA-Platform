// NEW BRANDS INTO THE BRAND PICKER (Vercel cron; see vercel.json).
//
// Daily, after the night's Brand Watch scans: every stocked brand with pieces
// that the onboarding / YOU picker does not name is filed into a group
// (lib/picker-placement), so new members are offered it. A member who took
// that whole world (every brand in it loved or never) gets the new brand added
// to her brands if its price bracket fits hers there (lib/world-join).
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/picker-brands?dry=1"
//
//   ?dry=1     file nothing, report what would be filed and who it would join
//   ?limit=N   at most N brands this run (default 60)

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { placeNewBrands } from '@/lib/picker-placement'
import { joinWholeWorlds, recentlyFiled } from '@/lib/world-join'

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
    const admin = createAdminClient() as any
    const result = await placeNewBrands(admin, { dry, limit })
    if (!dry && result.placed.length) {
      revalidatePath('/me/welcome')
      revalidatePath('/me/profile')
    }
    // Members who took a whole world get its new brands — every brand filed in
    // the last two days, so a run that failed here is made good tomorrow.
    let joined: Awaited<ReturnType<typeof joinWholeWorlds>> = []
    try {
      joined = await joinWholeWorlds(admin, dry ? result.placed : await recentlyFiled(admin), { dry })
    } catch (err) {
      console.error('[picker-brands] world join', err)
    }
    return NextResponse.json({ dry, ...result, joined })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

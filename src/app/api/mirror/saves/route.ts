import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { listSavesForMember } from '@/lib/mirror/save'

export const dynamic = 'force-dynamic'

// GET → her saved pieces across every site, with any live alerts on them.
export async function OPTIONS() { return mirrorOptions() }

export async function GET(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  return mirrorJson(await listSavesForMember(member))
}

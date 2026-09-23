import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { cachedGraph } from '@/lib/mirror/rank'
import { memberBrandSignals } from '@/lib/mirror/brand-signals'
import { createAdminClient } from '@/lib/supabase-server'
import { loadMemberSizeProfile } from '@/lib/size-availability'
import { CATEGORY_LABEL, SIZE_CATEGORIES, shortSizeLabel } from '@/lib/size-canonical'

export const dynamic = 'force-dynamic'

// GET with Bearer token → who the extension is connected as. Popup status only.
export async function OPTIONS() { return mirrorOptions() }

export async function GET(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ connected: false }, { status: 401 })
  const admin = createAdminClient() as any
  const [sig, sizeCtx] = await Promise.all([memberBrandSignals(member, await cachedGraph(admin), admin), loadMemberSizeProfile(member.member_id)])
  const sizes = SIZE_CATEGORIES.filter((c) => sizeCtx.profile[c]?.value != null)
    .map((c) => `${CATEGORY_LABEL[c].toLowerCase()} ${shortSizeLabel(sizeCtx.profile[c]!.value as number)}`)
  return mirrorJson({ connected: true, name: member.name, memberId: member.member_id, actingAdmin: member.actingAdmin, namedBrands: member.brands.map((b) => b.name), signals: sig.counts, sizes: { hasProfile: sizeCtx.hasProfile, summary: sizes.join(' · ') } })
}

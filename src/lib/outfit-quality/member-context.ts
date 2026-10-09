// A real member's taste and sizes, for Quality Lab generation.
//
// Her evaluation-profile cousin is frozen into the context snapshot; a real
// member is read live, through the same loaders the private-stylist composer
// uses, so the Lab builds for her exactly as /me would: her loved and avoided
// types (trainers first when she loves them), her hidden and input-only
// brands, her price ceiling, her rule layer, and her declared sizes.

import 'server-only'
import { loadMemberTasteFor } from '@/app/admin/private-stylist/actions'
import { loadMemberSizeProfile } from '@/lib/size-availability'
import type { SizeProfile } from '@/lib/size-canonical'
import type { MemberTaste } from '@/lib/pilot-composer'

export interface RealMemberContext {
  taste: MemberTaste | null
  /** Her canonical sizes; empty when she has told us none. */
  sizeProfile: SizeProfile
}

export async function loadRealMemberContext(memberId: string): Promise<RealMemberContext> {
  const [taste, size] = await Promise.all([
    loadMemberTasteFor(memberId).catch((err) => {
      console.error('[quality-lab] member taste unavailable', err)
      return null
    }),
    loadMemberSizeProfile(memberId),
  ])
  return { taste, sizeProfile: size.hasProfile ? size.profile : {} }
}

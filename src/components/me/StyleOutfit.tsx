'use client'

// STYLE IT — one of her looks, opened piece by piece so she can change any of
// it, the way the Dressing Room lets her change an outfit MYRA built: ⇄ Swap
// with search and brand / type / colour filters, Undo, and then SAVE as a new
// outfit of hers, with MYRA's picture to follow.

import { useState } from 'react'
import BuiltOutfit from '@/app/me/dressing-room/BuiltOutfit'
import SaveOutfit from '@/components/me/SaveOutfit'
import type { LookItem } from '@/lib/pilot-stylist'

const T = 'text-[19px] xl:text-[22px] 2xl:text-[26px]'
const T_SMALL = 'text-[17px] xl:text-[20px] 2xl:text-[23px]'

export default function StyleOutfit({
  items: initial, heroId, why, occasion, title, testMemberId, onClose,
}: {
  items: LookItem[]
  heroId?: string
  why?: string
  occasion?: string | null
  title?: string
  testMemberId?: string
  onClose: () => void
}) {
  const [items, setItems] = useState<LookItem[]>(initial)
  return (
    <div data-lenis-prevent className="fixed inset-0 z-[140] overflow-y-auto myra-pearl" role="dialog" aria-label="Style this outfit">
      <div className="w-full px-6 sm:px-10 py-10 max-w-[1700px] mx-auto space-y-8">
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>STYLE IT</p>
            <p className={`${T} text-[#2B2B2B] leading-tight`}>{title ?? 'Change any piece, then save it as a new outfit.'}</p>
          </div>
          <button type="button" onClick={onClose} className={`${T_SMALL} text-[#6E6B65] underline underline-offset-4`}>← Back</button>
        </div>
        <div className="max-w-[1100px]">
          <BuiltOutfit items={initial} heroId={heroId ?? ''} why={why ?? ''} testMemberId={testMemberId} onChange={setItems} />
        </div>
        <SaveOutfit items={items} why={why} occasion={occasion} testMemberId={testMemberId} label="Save as a new outfit" />
      </div>
    </div>
  )
}

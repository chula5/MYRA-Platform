'use client'

// WHAT SHE SEES.
//
// The same component her browser renders, with the same data shape, in
// read-only. Not a mock and not a second implementation: a mirror rebuilt
// separately drifts, and then what Chloe checks stops being what Alison sees.

import { useEffect, useState } from 'react'
import MyLooksClient from '@/app/me/looks/MyLooksClient'
import { loadLooksForMember, type ClientView } from '@/app/me/looks/actions'

export default function HerViewTab({
  members, memberId, setMemberId,
}: {
  members: { member_id: string; name: string }[]
  memberId: string
  setMemberId: (id: string) => void
}) {
  const [view, setView] = useState<ClientView | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!memberId) return
    let live = true
    setLoading(true)
    loadLooksForMember(memberId)
      .then((v) => { if (live) setView(v) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [memberId])

  const name = members.find((m) => m.member_id === memberId)?.name ?? ''

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1.5">
          {members.map((m) => (
            <button
              key={m.member_id}
              onClick={() => setMemberId(m.member_id)}
              className={`text-[20px] tracking-[0.1em] px-4 py-2 border transition-colors ${memberId === m.member_id ? 'border-[#0A0A0A] text-[#0A0A0A]' : 'border-[#E2E0DB] text-[#6B6B6B]'}`}
            >
              {m.name}
            </button>
          ))}
        </div>
        <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4]">
          {view ? `${view.looks.length} LOOKS SENT` : ''}
        </p>
      </div>

      {loading && <p className="text-[20px] tracking-[0.1em] text-[#A8A8A4]">LOADING HER VIEW…</p>}

      {view && !view.looks.length && !loading && (
        <div className="border border-[#E8D9B8] bg-[#FBF8F2] p-5">
          <p className="text-[20px] tracking-[0.08em] text-[#8B5E00]">
            {name.toUpperCase()} HAS NOT BEEN SENT ANYTHING YET
          </p>
          <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] mt-2">
            THIS IS EXACTLY WHAT SHE WOULD SEE ON SIGNING IN. USE SEND TO HER ON A SHOT
            LOOK, OR SEND HER EVERY SHOT LOOK, IN DELIVERIES.
          </p>
        </div>
      )}

      {/* Her page, her styling, in a frame that says it is hers. */}
      {view && view.looks.length > 0 && (
        <div className="border border-[#E2E0DB] bg-white">
          <p className="text-[20px] tracking-[0.14em] text-[#A8A8A4] border-b border-[#E2E0DB] px-5 py-3">
            HER SCREEN — READ ONLY. HER ANSWERS SHOW UNDER EACH LOOK; YOU CANNOT ANSWER FOR HER.
          </p>
          <div className="px-5 py-8 max-w-[1100px] mx-auto">
            <MyLooksClient view={view} readOnly />
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

// WHAT SHE SEES.
//
// The same components her browser renders, with the same data shapes, loaded
// AS her. Not a mock and not a second implementation: a mirror rebuilt
// separately drifts, and then what Chloe checks stops being what Alison sees.
// Each of her rooms is a tab; in all of them Chloe's taps are tests — outfits
// are composed and checked for real, but nothing she would record is saved.

import { useEffect, useState } from 'react'
import MyLooksClient from '@/app/me/looks/MyLooksClient'
import ForYouClient from '@/app/me/ForYouClient'
import DressingRoomClient from '@/app/me/dressing-room/DressingRoomClient'
import PieceClient from '@/app/me/dressing-room/PieceClient'
import InspirationBoard from '@/app/me/inspiration/InspirationBoard'
import MagazineClient from '@/app/me/magazine/MagazineClient'
import RoomNav, { ROOMS, type RoomId } from '@/components/me/RoomNav'
import { MirrorLoading } from '@/components/ArchiveCard'
import { loadLooksForMember, type ClientView } from '@/app/me/looks/actions'
import { loadForYou, type ForYouView } from '@/app/me/for-you-actions'
import { loadMyDressingRoom, loadMyPiece } from '@/app/me/dressing-room/actions'
import { loadMyInspiration, type InspirationBoardView } from '@/app/me/inspiration/board-actions'
import type { DressingRoomView, OwnedPieceView } from '@/app/admin/private-stylist/actions'

type Room = RoomId

export default function HerViewTab({
  members, memberId, setMemberId,
}: {
  members: { member_id: string; name: string }[]
  memberId: string
  setMemberId: (id: string) => void
}) {
  const [room, setRoom] = useState<Room>('for_you')
  const [search, setSearch] = useState('')
  const [looksView, setLooksView] = useState<ClientView | null>(null)
  const [forYou, setForYou] = useState<ForYouView | null>(null)
  const [dressing, setDressing] = useState<DressingRoomView | null>(null)
  const [piece, setPiece] = useState<OwnedPieceView | null>(null)
  const [inspiration, setInspiration] = useState<InspirationBoardView | null>(null)
  const [loading, setLoading] = useState(false)

  // A different member starts every room afresh.
  useEffect(() => {
    setLooksView(null); setForYou(null); setDressing(null); setPiece(null); setInspiration(null)
  }, [memberId])

  useEffect(() => {
    if (!memberId) return
    let live = true
    const load = async () => {
      if (room === 'all_looks' && !looksView) setLooksView(await loadLooksForMember(memberId))
      if (room === 'for_you' && !forYou) setForYou(await loadForYou(memberId))
      if (room === 'dressing_room' && !dressing) setDressing(await loadMyDressingRoom(memberId))
      if (room === 'inspiration' && !inspiration) setInspiration(await loadMyInspiration(memberId))
    }
    setLoading(true)
    load().finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [memberId, room, looksView, forYou, dressing, inspiration])

  async function openPiece(itemId: string) {
    setLoading(true)
    setPiece(await loadMyPiece(itemId, memberId))
    setLoading(false)
  }

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
          {looksView ? `${looksView.looks.length} LOOKS SENT` : ''}
        </p>
      </div>

      {/* Her rooms, as she would move between them. */}
      {/* Her own bar, full width of the screen — exactly what she taps. */}
      <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
        <RoomNav
          active={room}
          onSelect={(id) => { setRoom(id === 'profile' ? 'for_you' : id); setPiece(null) }}
          onSearch={(q) => { setRoom('all_looks'); setSearch(q) }}
        />
        <p className="myra-pearl text-[20px] tracking-[0.1em] text-[#55534E] text-center px-6 py-3">
          HER SCREEN, LOADED AS {name.toUpperCase()} — YOUR TAPS ARE TESTS: NOTHING IS SENT TO HER OR SAVED
        </p>
      </div>

      {loading && <MirrorLoading label={`LOADING ${name.toUpperCase()}'S ${ROOMS.find((r) => r.id === room)?.label ?? ''}`} />}

      {/* Her pages, full width of the screen — previews of front-end views, so
          they break out of the admin's column exactly as her browser shows them.
          No transform: that would break the wardrobe drawer's position: fixed. */}
      {!loading && room === 'for_you' && forYou && (
        <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
          <ForYouClient view={forYou} testMemberId={memberId} />
        </div>
      )}

      {!loading && room === 'all_looks' && looksView && (
        looksView.looks.length ? (
          <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
            <MyLooksClient view={looksView} readOnly initialQuery={search} key={search} />
          </div>
        ) : (
          <div className="border border-[#E8D9B8] bg-[#FBF8F2] p-5">
            <p className="text-[20px] tracking-[0.08em] text-[#8B5E00]">{name.toUpperCase()} HAS NOT BEEN SENT ANYTHING YET</p>
            <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] mt-2">
              THIS IS EXACTLY WHAT SHE WOULD SEE ON SIGNING IN. USE SEND TO HER ON A SHOT LOOK, OR SEND HER EVERY SHOT LOOK, IN DELIVERIES.
            </p>
          </div>
        )
      )}

      {/* The magazine loads her newsletters itself, as it does on her screen. */}
      {!loading && room === 'magazine' && (
        <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
          <MagazineClient key={memberId} testMemberId={memberId} />
        </div>
      )}

      {!loading && room === 'dressing_room' && !piece && dressing && (
        <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
          <DressingRoomClient view={dressing} testMemberId={memberId} onOpenPiece={openPiece} />
        </div>
      )}

      {!loading && room === 'inspiration' && inspiration && (
        <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
          <InspirationBoard view={inspiration} testMemberId={memberId} />
        </div>
      )}

      {!loading && room === 'dressing_room' && piece && (
        <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
          <PieceClient view={piece} testMemberId={memberId} onBack={() => setPiece(null)} />
        </div>
      )}
    </div>
  )
}

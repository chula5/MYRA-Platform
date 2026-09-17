'use client'

// DRESSING ROOM — her own pieces, laid out big. Each opens its own page:
// how it has been styled, STYLE THIS, and the finders.

import Link from 'next/link'
import FallbackImage from '@/components/FallbackImage'
import { ArchiveCard } from '@/components/ArchiveCard'
import type { DressingRoomView } from '@/app/admin/private-stylist/actions'
import EmailFinds from './EmailFinds'

export default function DressingRoomClient({
  view, testMemberId, onOpenPiece,
}: {
  view: DressingRoomView
  testMemberId?: string
  /** HER VIEW opens a piece in place rather than navigating. */
  onOpenPiece?: (itemId: string) => void
}) {
  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 pb-16">
        <ArchiveCard
          className="w-full"
          intro="settle"
          heading={
            <div className="text-center">
              <h1 className="text-[clamp(30px,5vw,72px)] tracking-[0.045em] text-[#4A4E57] leading-[1.05]">YOUR DRESSING ROOM</h1>
              <p className="myra-section-note mt-4">THE PIECES YOU OWN — TAP ONE TO STYLE IT</p>
              {view.test && (
                <p className="text-[18px] tracking-[0.1em] text-[#8B5E00] mt-4">
                  TEST AS {view.firstName.toUpperCase()} — OUTFITS ARE COMPOSED FOR REAL, NOTHING IS SAVED
                </p>
              )}
            </div>
          }
        >
          {view.error && <p className="text-[20px] text-[#B83A3A] text-center mb-6">{view.error}</p>}
          {/* Fill the dressing room from her order emails. */}
          <EmailFinds testMemberId={testMemberId} />
          {view.pieces.length === 0 ? (
            <div className="text-center py-10 space-y-4">
              <p className="text-[22px] text-[#4A4E57]">Nothing in your dressing room yet.</p>
              {!testMemberId && (
                <Link href="/me/wardrobe" className="inline-block text-[22px] px-7 py-4 bg-[#2B2B2B] text-white">Add your pieces</Link>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6 gap-[6px] w-full">
                {view.pieces.map((p) => {
                  const body = (
                    <>
                      <div className="relative aspect-[3/4] bg-[#EDEDED] overflow-hidden">
                        {p.image_url && <FallbackImage src={p.image_url} thumbWidth={600} alt={p.product_name} className="absolute inset-0 w-full h-full object-contain" />}
                      </div>
                      <div className="px-4 py-3.5 text-left">
                        <p className="text-[20px] text-[#2B2B2B] leading-tight line-clamp-2">{p.product_name}</p>
                        <p className="text-[18px] text-[#6E6B65] mt-1">
                          {p.styled_in ? `Styled in ${p.styled_in} look${p.styled_in === 1 ? '' : 's'}` : 'Not styled yet'}
                        </p>
                      </div>
                    </>
                  )
                  return onOpenPiece ? (
                    <button key={p.item_id} onClick={() => onOpenPiece(p.item_id)} className="bg-white hover:outline hover:outline-2 hover:outline-[#2B2B2B]">{body}</button>
                  ) : (
                    <Link key={p.item_id} href={`/me/dressing-room/${p.item_id}`} className="bg-white hover:outline hover:outline-2 hover:outline-[#2B2B2B]">{body}</Link>
                  )
                })}
              </div>
              {!testMemberId && (
                <p className="text-center mt-10">
                  <Link href="/me/wardrobe" className="text-[22px] text-[#2B2B2B] underline underline-offset-4">Add more pieces →</Link>
                </p>
              )}
            </>
          )}
        </ArchiveCard>
      </div>
    </div>
  )
}

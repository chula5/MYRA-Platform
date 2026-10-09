'use client'

// SAVED FROM THE SHOPS — the pieces she kept with the MYRA mirror while she was
// out shopping. They are not hers yet, so they sit beside her wardrobe rather
// than in it: each one can be styled (her own pieces come into the outfit), or
// let go of. MYRA watches their stock and tells her before one goes.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import WaysToWear from '@/components/me/WaysToWear'
import { useWaysReady } from '@/components/me/ways-watch'
import { forgetMySavedPiece, loadMySavedPieces } from './actions'
import type { SavedPieceView } from '@/app/admin/private-stylist/actions'

const T = 'text-[20px] xl:text-[23px] 2xl:text-[27px]'
const T_SMALL = 'text-[18px] xl:text-[21px] 2xl:text-[25px]'
const CARD = 'rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)]'

export default function SavedPieces({ testMemberId }: { testMemberId?: string }) {
  const [pieces, setPieces] = useState<SavedPieceView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadMySavedPieces(testMemberId).then((r) => { if (!live) return; setPieces(r.pieces); setError(r.error ?? null) })
    return () => { live = false }
  }, [testMemberId])

  async function forget(itemId: string) {
    setPieces((cur) => (cur ?? []).filter((p) => p.item_id !== itemId))
    if (open === itemId) setOpen(null)
    await forgetMySavedPiece(itemId, testMemberId)
  }

  // Nothing saved yet is not worth a section of its own.
  if (!pieces || (!pieces.length && !error)) return null

  return (
    <section id="saved-pieces" className={`w-full ${CARD} px-5 md:px-8 py-7 space-y-6 scroll-mt-6`}>
      <div className="flex items-center gap-3">
        <img src="/shopping-bags.png" alt="" className="h-10 w-10 object-contain grayscale" />
        <h2 className="text-[26px] xl:text-[29px] 2xl:text-[33px] tracking-[0.06em] text-[#2B2B2B]">SAVED FROM THE SHOPS</h2>
      </div>

      {error && <p className={`${T} text-[#9B3A3A]`}>{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 min-[2200px]:grid-cols-6 gap-4">
        {pieces.map((p) => {
          const gone = p.stock_status === 'out_of_stock'
          return (
            <SavedTile key={p.item_id} piece={p} open={open === p.item_id} gone={gone} onOpen={() => setOpen(p.item_id)} />
          )
        })}
      </div>

      {open && (() => {
        const p = pieces.find((x) => x.item_id === open)
        return (
          <WaysToWear
            inline
            itemId={open}
            piece={p ? { item_id: p.item_id, product_name: p.product_name, brand: p.brand, image_url: p.image_url } : null}
            testMemberId={testMemberId}
            onClose={() => setOpen(null)}
          />
        )
      })()}
    </section>
  )
}

function SavedTile({ piece: p, open, gone, onOpen }: { piece: SavedPieceView; open: boolean; gone: boolean; onOpen: () => void }) {
  const ready = useWaysReady(p.item_id)
  return (
            <button type="button" onClick={onOpen} className={`text-left bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)] ${open ? 'ring-2 ring-[#2B2B2B]' : ''}`}>
              <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                {p.image_url && <FallbackImage src={p.image_url} thumbWidth={600} alt={p.product_name} className="absolute inset-0 w-full h-full object-cover" />}
                {gone && (
                  <span className="absolute top-3 left-3 rounded-full bg-[rgba(255,255,255,0.94)] px-3 py-1 text-[16px] text-[#9B3A3A]">Gone</span>
                )}
                {ready && !open && (
                  <span className="absolute top-3 right-3 rounded-full bg-[#2B2B2B] px-3 py-1 text-[15px] text-white">Ways ready</span>
                )}
              </div>
              <div className="px-3 py-2">
                <p className="text-[14px] xl:text-[16px] text-[#2B2B2B] leading-tight truncate">{p.product_name}</p>
              </div>
            </button>
  )
}


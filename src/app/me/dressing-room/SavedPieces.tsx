'use client'

// SAVED FROM THE SHOPS — the pieces she kept with the MYRA mirror while she was
// out shopping. They are not hers yet, so they sit beside her wardrobe rather
// than in it: each one can be styled (her own pieces come into the outfit), or
// let go of. MYRA watches their stock and tells her before one goes, and —
// when she rings WAIT FOR SALE on one — tells her the moment its price drops.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import WaysToWear from '@/components/me/WaysToWear'
import ShareWithFriend from '@/components/me/ShareWithFriend'
import { useWaysReady } from '@/components/me/ways-watch'
import { forgetMySavedPiece, loadMySavedPieces } from './actions'
import type { SavedPieceView } from '@/app/admin/private-stylist/actions'
import { loadMyPriceWatches, togglePriceWatch, type PriceWatch } from './price-watch-actions'

const T = 'text-[20px] xl:text-[23px] 2xl:text-[27px]'
const T_SMALL = 'text-[18px] xl:text-[21px] 2xl:text-[25px]'
const CARD = 'rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)]'

export default function SavedPieces({ testMemberId, onCount }: { testMemberId?: string; onCount?: (n: number) => void }) {
  const [pieces, setPieces] = useState<SavedPieceView[] | null>(null)
  // The room's SAVED tab shows the count.
  useEffect(() => { if (pieces) onCount?.(pieces.length) }, [pieces, onCount])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [watches, setWatches] = useState<Map<string, PriceWatch>>(new Map())

  useEffect(() => {
    let live = true
    void loadMyPriceWatches(testMemberId).then((r) => { if (live) setWatches(new Map(r.watches.map((w) => [w.item_id, w]))) }).catch(() => { /* the bell is a nicety */ })
    void loadMySavedPieces(testMemberId).then((r) => {
      if (!live) return
      setPieces(r.pieces); setError(r.error ?? null)
      // The morning note links a piece straight here (?piece=<id>): open its ways.
      try {
        const wanted = new URLSearchParams(window.location.search).get('piece')
        if (wanted && r.pieces.some((p) => p.item_id === wanted)) {
          setOpen(wanted)
          setTimeout(() => document.getElementById(`saved-${wanted}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
        }
      } catch { /* no window, no deep link */ }
    })
    return () => { live = false }
  }, [testMemberId])

  async function forget(itemId: string) {
    setPieces((cur) => (cur ?? []).filter((p) => p.item_id !== itemId))
    if (open === itemId) setOpen(null)
    await forgetMySavedPiece(itemId, testMemberId)
  }

  async function ring(p: SavedPieceView) {
    const was = watches.get(p.item_id)
    const on = !was?.watching
    setWatches((m) => new Map(m).set(p.item_id, { item_id: p.item_id, watching: on, price_at_watch: on ? p.price_gbp : null, lowest_seen: null, dropped_at: null }))
    const r = await togglePriceWatch(p.item_id, testMemberId).catch(() => ({ error: 'failed' }) as { watching?: boolean; error?: string })
    if (r.error) setWatches((m) => { const n = new Map(m); if (was) n.set(p.item_id, was); else n.delete(p.item_id); return n })
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
            <div key={p.item_id} id={`saved-${p.item_id}`}>
              <div className="relative">
                <SavedTile piece={p} open={open === p.item_id} gone={gone} onOpen={() => setOpen(p.item_id)} />
                {/* Pass the piece to a friend on MYRA. */}
                <ShareWithFriend
                  variant="icon"
                  testMemberId={testMemberId}
                  className="absolute bottom-[52px] right-3"
                  attachment={{ kind: 'piece', item_id: p.item_id, brand: p.brand, product_name: p.product_name, image_url: p.image_url, url: p.retailer_url, price_gbp: p.price_gbp }}
                />
              </div>
              {!gone && <SaleBell piece={p} watch={watches.get(p.item_id)} onRing={() => void ring(p)} />}
            </div>
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

// WAIT FOR SALE: a bell under the piece. Rung, MYRA reads its price every half
// hour and tells her at once when it drops; dropped, the tile says by how much.
function SaleBell({ piece: p, watch, onRing }: { piece: SavedPieceView; watch?: PriceWatch; onRing: () => void }) {
  const on = !!watch?.watching
  const was = watch?.price_at_watch ?? null
  const onSale = on && watch?.lowest_seen != null && was != null && watch.lowest_seen < was
  return (
    <button
      type="button"
      onClick={onRing}
      aria-pressed={on}
      aria-label={on ? 'Stop waiting for a sale' : 'Wait for this to go on sale'}
      className={`mt-2 w-full flex items-center justify-center gap-2 rounded-full px-3 py-2.5 text-[15px] xl:text-[17px] tracking-[0.08em] ${on ? 'bg-[#2B2B2B] text-white' : 'border border-[rgba(43,43,43,0.28)] text-[#2B2B2B] hover:bg-white'}`}
    >
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" />
      </svg>
      <span className="truncate">
        {onSale ? `ON SALE £${Math.round(watch!.lowest_seen!)} · WAS £${Math.round(was!)}` : on ? 'WAITING FOR SALE' : 'WAIT FOR SALE'}
      </span>
    </button>
  )
}

function SavedTile({ piece: p, open, gone, onOpen }: { piece: SavedPieceView; open: boolean; gone: boolean; onOpen: () => void }) {
  const ready = useWaysReady(p.item_id)
  return (
            <button type="button" onClick={onOpen} className={`block w-full text-left bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)] ${open ? 'ring-2 ring-[#2B2B2B]' : ''}`}>
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


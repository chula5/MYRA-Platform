'use client'

// SAVED FROM THE SHOPS — the pieces she kept with the MYRA mirror while she was
// out shopping. They are not hers yet, so they sit beside her wardrobe rather
// than in it: each one can be styled (her own pieces come into the outfit), or
// let go of. MYRA watches their stock and tells her before one goes.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import BuiltOutfit from './BuiltOutfit'
import { forgetMySavedPiece, loadMySavedPieces, styleMySavedPiece } from './actions'
import type { SavedPieceView } from '@/app/admin/private-stylist/actions'
import type { StyledLook } from '@/app/admin/private-stylist/actions'

const T = 'text-[20px] xl:text-[23px] 2xl:text-[27px]'
const T_SMALL = 'text-[18px] xl:text-[21px] 2xl:text-[25px]'
const CARD = 'rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)]'

export default function SavedPieces({ testMemberId }: { testMemberId?: string }) {
  const [pieces, setPieces] = useState<SavedPieceView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [looks, setLooks] = useState<StyledLook[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [shuffle, setShuffle] = useState(0)

  useEffect(() => {
    let live = true
    void loadMySavedPieces(testMemberId).then((r) => { if (!live) return; setPieces(r.pieces); setError(r.error ?? null) })
    return () => { live = false }
  }, [testMemberId])

  async function style(itemId: string, next = 0) {
    setOpen(itemId)
    setBusy(true)
    setNote(null)
    setLooks([])
    const r = await styleMySavedPiece(itemId, { shuffle: next }, testMemberId)
    setBusy(false)
    setLooks(r.looks ?? [])
    setNote(r.error ?? (r.looks?.length ? null : 'Nothing in your size goes with it yet.'))
  }

  async function forget(itemId: string) {
    setPieces((cur) => (cur ?? []).filter((p) => p.item_id !== itemId))
    if (open === itemId) { setOpen(null); setLooks([]) }
    await forgetMySavedPiece(itemId, testMemberId)
  }

  // Nothing saved yet is not worth a section of its own.
  if (!pieces || (!pieces.length && !error)) return null

  return (
    <section id="saved-pieces" className={`w-full ${CARD} px-5 md:px-8 py-7 space-y-6 scroll-mt-6`}>
      <div className="space-y-2">
        <h2 className="text-[26px] xl:text-[29px] 2xl:text-[33px] tracking-[0.06em] text-[#2B2B2B]">SAVED FROM THE SHOPS</h2>
        <p className={`${T} text-[#4A4E57] max-w-4xl`}>
          What you kept with MYRA while you were out. Style any of them against what you already own — and MYRA watches their stock, so you hear before one goes.
        </p>
      </div>

      {error && <p className={`${T} text-[#9B3A3A]`}>{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 min-[2200px]:grid-cols-6 gap-4">
        {pieces.map((p) => {
          const gone = p.stock_status === 'out_of_stock'
          return (
            <article key={p.item_id} className={`bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)] flex flex-col ${open === p.item_id ? 'ring-2 ring-[#2B2B2B]' : ''}`}>
              <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                {p.image_url && <FallbackImage src={p.image_url} thumbWidth={600} alt={p.product_name} className="absolute inset-0 w-full h-full object-cover" />}
                {gone && (
                  <span className="absolute top-3 left-3 rounded-full bg-[rgba(255,255,255,0.94)] px-3 py-1 text-[16px] text-[#9B3A3A]">Gone</span>
                )}
              </div>
              <div className="px-4 py-3 space-y-1 flex-1 flex flex-col">
                <p className={`${T_SMALL} text-[#6E6B65]`}>{(p.brand ?? p.source_host ?? '').toUpperCase()}</p>
                <p className={`${T_SMALL} text-[#2B2B2B] leading-tight line-clamp-2`}>{p.product_name}</p>
                {p.price_gbp != null && <p className={`${T_SMALL} text-[#6E6B65]`}>£{Math.round(p.price_gbp)}</p>}
                <div className="flex flex-wrap gap-3 pt-2 mt-auto">
                  <button
                    onClick={() => style(p.item_id, 0)}
                    disabled={busy && open === p.item_id}
                    className={`${T_SMALL} px-4 py-2 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40`}
                  >
                    {busy && open === p.item_id ? 'Building…' : 'Style this'}
                  </button>
                  {p.retailer_url && (
                    <a href={p.retailer_url} target="_blank" rel="noreferrer" className={`${T_SMALL} text-[#2B2B2B] underline underline-offset-4 self-center`}>Open</a>
                  )}
                  <button onClick={() => forget(p.item_id)} className={`${T_SMALL} text-[#6E6B65] self-center hover:text-[#9B3A3A]`}>Forget</button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {open && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>
              WAYS TO WEAR {(pieces.find((p) => p.item_id === open)?.product_name ?? '').toUpperCase()}
            </p>
            {!busy && looks.length > 0 && (
              <button onClick={() => { const n = shuffle + 1; setShuffle(n); void style(open, n) }} className={`${T_SMALL} px-4 py-2 rounded-full bg-white text-[#2B2B2B] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)]`}>
                Reshuffle
              </button>
            )}
            <button onClick={() => { setOpen(null); setLooks([]) }} className={`${T_SMALL} text-[#6E6B65] underline underline-offset-4`}>Close</button>
          </div>
          {busy && (
            <div className="rounded-[16px] bg-white/70 px-6 py-10 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-24 w-auto mx-auto" />
              <p className={`${T} text-[#4A4E57] mt-4`}>Building outfits around it…</p>
            </div>
          )}
          {note && !busy && <p className={`${T} text-[#4A4E57]`}>{note}</p>}
          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
            {looks.map((l, i) => (
              <BuiltOutfit key={i} items={l.items} heroId={open} why={l.why} testMemberId={testMemberId} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

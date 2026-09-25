'use client'

// MYRA WORKED WHILE YOU SHOPPED.
//
// Three answers to a question she has not asked yet, sitting above her looks:
// more like the pieces she kept out there, more from the labels she was
// reading, and those pieces already styled. She hearts something on a brand's
// own site and by the time she opens MYRA the thinking has been done.
//
// It draws nothing at all until she has kept something — an empty promise is
// worse than no promise.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import ShopLink from '@/components/ShopLink'
import ComposedLookCard from '@/components/me/ComposedLookCard'
import { loadShopBrain, styleSavedPieceFor, type ShopBrainView, type ShopPiece } from './shop-brain-actions'
import type { StyledLook } from '@/app/admin/private-stylist/actions'

const COLUMN = 'flex flex-col'
const HEAD = 'myra-section-label'
const NOTE = 'myra-section-note mt-1.5'

function Piece({ piece }: { piece: ShopPiece }) {
  const body = (
    <>
      <div className="relative aspect-[3/4] bg-white overflow-hidden">
        {piece.image_url && (
          <FallbackImage src={piece.image_url} thumbWidth={400} alt={piece.product_name} className="absolute inset-0 w-full h-full object-contain" />
        )}
      </div>
      <p className="mt-2 text-[17px] text-[#2B2B2B] leading-[1.2]">{piece.brand ?? piece.product_name}</p>
      <p className="text-[15px] text-[#7C838B] leading-[1.25] line-clamp-1">{piece.product_name}</p>
      {piece.price_gbp != null && <p className="text-[15px] text-[#7C838B]">£{Math.round(piece.price_gbp)}</p>}
    </>
  )
  if (!piece.url) return <div className="block">{body}</div>
  return (
    <ShopLink
      item={{ item_id: piece.item_id, retailer_url: piece.url, product_name: piece.product_name, brand: { name: piece.brand } }}
      className="block group"
    >
      {body}
    </ShopLink>
  )
}

function Pieces({ pieces }: { pieces: ShopPiece[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 mt-5">
      {pieces.map((p) => <Piece key={p.item_id} piece={p} />)}
    </div>
  )
}

export default function ShopBrain({ testMemberId }: { testMemberId?: string }) {
  const [view, setView] = useState<ShopBrainView | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [looks, setLooks] = useState<Record<string, StyledLook[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<Record<string, string>>({})

  useEffect(() => { void loadShopBrain(testMemberId).then(setView) }, [testMemberId])

  // The newest piece she kept is styled without being asked — that is the
  // whole point: the work is done before she arrives.
  useEffect(() => {
    const first = view?.saved[0]?.item_id
    if (!first || anchor) return
    setAnchor(first)
    void style(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  async function style(itemId: string) {
    if (looks[itemId] || failed[itemId] || busy) return
    setBusy(itemId)
    const r = await styleSavedPieceFor(itemId, testMemberId)
    setBusy(null)
    if (r.error || !r.looks.length) {
      setFailed((f) => ({ ...f, [itemId]: r.error ?? 'Nothing MYRA would put with it yet.' }))
      return
    }
    setLooks((l) => ({ ...l, [itemId]: r.looks }))
  }

  if (!view || !view.saved.length) return null

  const kept = view.saved.length
  const labels = view.brands.slice(0, 2)
  const brandLine = labels.length ? labels.join(' & ').toUpperCase() : 'THOSE LABELS'
  const current = anchor ? view.saved.find((s) => s.item_id === anchor) ?? view.saved[0] : view.saved[0]
  const shown = current ? looks[current.item_id] : undefined

  return (
    <section className="mb-16">
      <div className="text-center mb-8">
        <p className={HEAD}>MYRA WORKED WHILE YOU SHOPPED</p>
        <p className="myra-guide-text mt-3 text-[clamp(21px,1.25vw,32px)] text-[#55534E]">
          You kept {kept} piece{kept === 1 ? '' : 's'} out there. This is what came of {kept === 1 ? 'it' : 'them'}.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* ── 1 ── */}
        <div className={COLUMN}>
          <p className={HEAD}>MORE OF THE SAME</p>
          <p className={NOTE}>CLOSE TO WHAT YOU KEPT</p>
          {view.similar.length ? (
            <>
              <Pieces pieces={view.similar.slice(0, 6)} />
              {view.similar[0]?.because && (
                <p className="text-[15px] text-[#7C838B] mt-4">{view.similar[0].because}.</p>
              )}
            </>
          ) : (
            <p className="text-[19px] text-[#55534E] mt-5">Nothing close enough yet — MYRA would rather show you nothing than something near it.</p>
          )}
        </div>

        {/* ── 2 ── */}
        <div className={COLUMN}>
          <p className={HEAD}>{view.fromBrandsKind === 'same' ? `MORE FROM ${brandLine}` : `BRANDS LIKE ${brandLine}`}</p>
          <p className={NOTE}>
            {view.fromBrandsKind === 'same' ? 'THE LABELS YOU WERE READING' : `MYRA DOESN'T STOCK ${brandLine} — THESE STAND BESIDE IT`}
          </p>
          {view.fromBrands.length ? (
            <Pieces pieces={view.fromBrands.slice(0, 6)} />
          ) : (
            <p className="text-[19px] text-[#55534E] mt-5">Nothing from {labels.length ? labels.join(' or ') : 'those labels'} or their neighbours yet. MYRA is watching them.</p>
          )}
        </div>

        {/* ── 3 ── */}
        <div className={COLUMN}>
          <p className={HEAD}>YOUR SAVED PIECES, STYLED</p>
          <p className={NOTE}>{busy ? 'MYRA IS PUTTING OUTFITS TOGETHER…' : 'ALREADY DONE FOR YOU'}</p>

          <div data-lenis-prevent className="flex gap-2 mt-5 overflow-x-auto pb-1">
            {view.saved.slice(0, 8).map((s) => (
              <button
                key={s.item_id}
                onClick={() => { setAnchor(s.item_id); void style(s.item_id) }}
                aria-label={`Style your ${s.brand ?? s.product_name}`}
                className={`relative flex-none w-[62px] aspect-[3/4] bg-white overflow-hidden transition-opacity ${current?.item_id === s.item_id ? 'ring-2 ring-[#2B2B2B]' : 'opacity-65 hover:opacity-100'}`}
              >
                {s.image_url && <FallbackImage src={s.image_url} thumbWidth={200} alt={s.product_name} className="absolute inset-0 w-full h-full object-contain" />}
              </button>
            ))}
          </div>

          {current && (
            <p className="text-[17px] text-[#2B2B2B] mt-4">
              {current.brand ?? current.product_name}
              {current.host ? <span className="text-[#7C838B]"> · {current.host}</span> : null}
            </p>
          )}

          <div className="mt-4 space-y-4">
            {shown ? (
              shown.slice(0, 2).map((l, i) => <ComposedLookCard key={i} look={l} heroId={current?.item_id} />)
            ) : busy === current?.item_id ? (
              [0, 1].map((i) => (
                <div key={i} className="h-[190px] rounded-[18px] bg-gradient-to-r from-[#EFEFED] via-[#F7F7F5] to-[#EFEFED]" />
              ))
            ) : (
              <p className="text-[19px] text-[#55534E]">{(current && failed[current.item_id]) ?? 'Tap a piece to see it styled.'}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

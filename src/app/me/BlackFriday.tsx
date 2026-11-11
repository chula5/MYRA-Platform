'use client'

// BLACK FRIDAY — the sales at her own brands, on For You.
//
// Drawn only while one of her brands is on sale with pieces in her size
// (lib/sales/picks). The brands come first as a row she can narrow by; then
// the pieces, in a stylist's order: what fills a gap in her wardrobe, what she
// was waiting for, what her searches found, then the rest from her labels.
// Every piece shows what it costs now and what it cost, and why it is here.
// Fetched by itself after the page opens, so the sale never holds the curtain.

import { useEffect, useMemo, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import SavePieceHeart from '@/components/me/SavePieceHeart'
import WaysToWear from '@/components/me/WaysToWear'
import { loadMySale, type SaleView, type SalePiece } from './sale-actions'

const HEAD = 'myra-section-label !text-[clamp(28px,3vw,46px)]'
const NOTE = 'myra-section-note mt-2 !text-[clamp(17px,1.6vw,24px)]'
const FIRST = 24

const SLOT_WORD: Record<string, string> = {
  top: 'TOPS', bottom: 'TROUSERS AND SKIRTS', shoe: 'SHOES', outerwear: 'COATS', dress: 'DRESSES', bag: 'BAGS', jewellery: 'JEWELLERY', accessory: 'ACCESSORIES',
}

/** `standalone`: the SALE page from the price tag — more pieces, and says so when nothing is on sale. */
export default function BlackFriday({ testMemberId, standalone = false }: { testMemberId?: string; standalone?: boolean }) {
  const [view, setView] = useState<(SaleView & { blackFriday: boolean }) | null>(null)
  const [brand, setBrand] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  // The piece she tapped, open in the mirror — the shop is the last step.
  const [opened, setOpened] = useState<SalePiece | null>(null)

  useEffect(() => {
    let live = true
    loadMySale(testMemberId, standalone ? 160 : 48).then((v) => { if (live) setView(v) }).catch(() => { /* no sale section is no loss */ })
    return () => { live = false }
  }, [testMemberId, standalone])

  const shown = useMemo(() => {
    const list = view?.pieces ?? []
    return brand ? list.filter((p) => p.brand === brand) : list
  }, [view, brand])

  if (standalone && view && !view.pieces.length) {
    return (
      <section className="text-center max-w-[620px] mx-auto mt-16">
        <h2 className={HEAD}>THE SALE</h2>
        <p className="myra-guide-text normal-case text-[19px] sm:text-[21px] text-[#4A4E57] mt-5">
          None of your brands has a sale on right now. MYRA checks them every few hours and tells you the moment one starts — ring WAIT FOR SALE on a saved piece to hear when that one drops.
        </p>
      </section>
    )
  }
  if (!view || !view.pieces.length) return null
  const gapLine = view.gaps.length ? `YOUR WARDROBE IS SHORT OF ${view.gaps.slice(0, 2).map((g) => SLOT_WORD[g.slot] ?? g.slot.toUpperCase()).join(' AND ')} — THOSE COME FIRST` : null

  return (
    <section id="black-friday" className="mb-20 pt-2 scroll-mt-28">
      <h2 className={HEAD}>{view.blackFriday ? 'BLACK FRIDAY' : 'IN THE SALE'}</h2>
      <p className={NOTE}>YOUR BRANDS ON SALE, IN YOUR SIZE</p>
      {gapLine && <p className="mt-3 text-[17px] sm:text-[20px] tracking-[0.1em] text-[#2B2B2B]">{gapLine}</p>}

      {/* Her brands on sale: tap one to see only its pieces. */}
      <div className="flex flex-wrap gap-2 mt-6">
        <button
          type="button"
          onClick={() => setBrand(null)}
          className={`text-[16px] sm:text-[18px] tracking-[0.08em] rounded-full px-5 py-2.5 border ${brand == null ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'border-[rgba(43,43,43,0.28)] text-[#2B2B2B] hover:bg-white'}`}
        >
          ALL · {view.pieces.length}
        </button>
        {view.brands.map((b) => (
          <button
            key={b.brand_id}
            type="button"
            onClick={() => { setBrand(brand === b.name ? null : b.name); setAll(false) }}
            className={`text-[16px] sm:text-[18px] tracking-[0.08em] rounded-full px-5 py-2.5 border ${brand === b.name ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'border-[rgba(43,43,43,0.28)] text-[#2B2B2B] hover:bg-white'}`}
          >
            {b.name.toUpperCase()} <span className="text-[#7C838B]">· {b.line}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-5 mt-7">
        {(all || standalone ? shown : shown.slice(0, FIRST)).map((p) => <SaleCard key={p.item_id} piece={p} onOpen={setOpened} />)}
      </div>
      {!all && !standalone && shown.length > FIRST && (
        <div className="text-center mt-8">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="text-[16px] sm:text-[18px] tracking-[0.1em] rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-7 py-3 hover:bg-white"
          >
            SEE ALL {shown.length}
          </button>
        </div>
      )}

      {opened && (
        <WaysToWear
          itemId={opened.item_id}
          piece={{ item_id: opened.item_id, product_name: opened.product_name, brand: opened.brand, image_url: opened.image_url, url: opened.url, price_gbp: opened.price_gbp }}
          testMemberId={testMemberId}
          autoStart={false}
          startLabel="Build outfits with it"
          onClose={() => setOpened(null)}
        />
      )}
    </section>
  )
}

function SaleCard({ piece: p, onOpen }: { piece: SalePiece; onOpen: (p: SalePiece) => void }) {
  const body = (
    <>
      <div className="relative aspect-[3/4] bg-white overflow-hidden rounded-[14px]">
        {p.image_url && <FallbackImage src={p.image_url} thumbWidth={400} alt={p.product_name} className="absolute inset-0 w-full h-full object-contain" />}
        <span className="absolute bottom-2.5 left-2.5 rounded-full bg-[#2B2B2B] text-white px-3 py-1 text-[15px] tracking-[0.08em]">−{p.off}%</span>
      </div>
      <p className="mt-3 text-[20px] xl:text-[24px] text-[#2B2B2B] leading-[1.2]">{p.brand ?? p.product_name}</p>
      <p className="text-[17px] xl:text-[20px] text-[#7C838B] leading-[1.25] line-clamp-1">{p.product_name}</p>
      <p className="text-[19px] xl:text-[22px] text-[#2B2B2B]">
        £{Math.round(p.price_gbp)} <span className="text-[#7C838B] line-through ml-1">£{Math.round(p.was_price_gbp)}</span>
      </p>
      {p.reason && <p className="mt-1 text-[15px] xl:text-[17px] tracking-[0.08em] text-[#7C838B] leading-snug">{p.reason}</p>}
    </>
  )
  return (
    <div className="relative">
      <button type="button" onClick={() => onOpen(p)} className="block w-full text-left group" aria-label={`Open ${p.product_name}`}>
        {body}
      </button>
      <SavePieceHeart itemId={p.item_id} className="absolute top-2.5 right-2.5" />
    </div>
  )
}

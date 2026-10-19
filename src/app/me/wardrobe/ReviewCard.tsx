'use client'

// A PIECE MYRA FOUND IN HER PHOTO — the card she answers. One card per
// garment: the crop it came from, the cutout, its name and brand to correct,
// and two answers: YES, ADD TO MY WARDROBE, or not this one. The same card
// stands on her wardrobe page and in the Dressing Room, so a piece is
// answered once wherever she meets it.

import { useState } from 'react'
import type { WardrobeExtraction } from '@/lib/wardrobe/types'
import { approveMine, discardMine, regenerateMine } from './actions'

export type Act = (key: string, fn: () => Promise<{ error?: string } | any>) => Promise<void>

export default function ReviewCard({ x, busy, act }: { x: WardrobeExtraction; busy: string | null; act: Act }) {
  const d = x.detected
  const [brand, setBrand] = useState(x.edits?.brand_name ?? d.brand_hint ?? '')
  const [name, setName] = useState(x.edits?.product_name ?? titleCase(d.name))
  const [direction, setDirection] = useState('')
  const [more, setMore] = useState(false)
  const ready = x.status === 'review' && !!x.cutout_url && !!x.scores
  return (
    <div className="border border-[#E2E0DB] rounded-[12px] overflow-hidden bg-white">
      {/* On a phone the two pictures sit side by side and the words go under them; wider, all in a row. */}
      <div className="flex flex-col sm:flex-row gap-3 p-3">
        <div className="flex gap-3 shrink-0">
          {x.crop_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={x.crop_url} alt="" className="w-24 aspect-[3/4] object-cover bg-[#F8F8F6] rounded-[8px] shrink-0" />
          )}
          {x.cutout_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={x.cutout_url} alt="" className="w-28 aspect-[3/4] object-contain bg-white border border-[#F0EEE9] rounded-[8px] shrink-0" />
          ) : (
            <div className="w-28 aspect-[3/4] bg-[#F8F8F6] rounded-[8px] shrink-0 flex items-center justify-center text-center px-2">
              <span className="text-[15px] text-[#A8A8A4]">{x.status === 'failed' ? 'Didn’t work' : 'Cutting out…'}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[17px] text-[#0A0A0A]" value={name} onChange={(e) => setName(e.target.value)} aria-label="Piece name" />
          <input className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[15px] text-[#0A0A0A]" placeholder="Brand, if you know it" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand" />
          {x.error && <p className="text-[15px] text-[#7C838B]">{plain(x.error)}</p>}
        </div>
      </div>
      <div className="border-t border-[#E2E0DB] px-3 py-3 flex flex-wrap items-center gap-x-4 gap-y-3 bg-[#FAFAF8]">
        <button
          className="w-full sm:w-auto bg-[#0A0A0A] text-white rounded-[10px] px-5 py-3 text-[15px] tracking-[0.08em] disabled:opacity-40"
          disabled={!ready || busy === `ap-${x.extraction_id}`}
          onClick={() => act(`ap-${x.extraction_id}`, () => approveMine(x.extraction_id, { product_name: name || null, brand_name: brand || null }))}
        >
          YES, ADD TO MY WARDROBE
        </button>
        <button className="text-[15px] text-[#6B6B6B] underline" disabled={busy === `dc-${x.extraction_id}`} onClick={() => act(`dc-${x.extraction_id}`, () => discardMine(x.extraction_id))}>Not this one</button>
        {!more ? (
          <button className="text-[15px] text-[#A8A8A4] underline ml-auto" onClick={() => setMore(true)}>Try again</button>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            <input className="w-40 border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[15px]" placeholder="What’s wrong?" value={direction} onChange={(e) => setDirection(e.target.value)} />
            <button className="text-[15px] text-[#0A0A0A] underline" disabled={busy === `rg-${x.extraction_id}`} onClick={() => act(`rg-${x.extraction_id}`, () => regenerateMine(x.extraction_id, direction || null))}>Go</button>
          </div>
        )}
      </div>
    </div>
  )
}

/** What went wrong, in her words — never an API's. A failed scoring is retried on its own. */
function plain(e: string): string {
  if (/^Scoring failed/i.test(e)) return 'Still checking this one — MYRA will try again in a few minutes.'
  if (/credit|balance|quota|rate limit/i.test(e)) return 'MYRA is busy — this one will be tried again.'
  return e.length > 120 ? 'This one didn’t work. Try again, or not this one.' : e
}

export function titleCase(s: string): string {
  return s.split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

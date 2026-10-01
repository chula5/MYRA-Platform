'use client'

// BROWSE — looking something up.
//
// The bar rests in the middle of the page until she asks for something. When
// she does it travels up out of the way, and MYRA looks: the mirror wiggles
// while it does, the way it does everywhere else in the house.
//
// What comes back is only pieces — a photograph, a label, a price. She taps
// one and says how she wants to see it: around what she already owns, or
// around something new.

import { useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import ComposedLookCard from '@/components/me/ComposedLookCard'
import type { StyledLook } from '@/app/admin/private-stylist/actions'
import { browseSearch, styleBrowsedPiece, type BrowsePiece } from './actions'

/** What to try when she has not thought of anything yet. */
const PROMPTS = ['A black dress for a winter wedding', 'Leather jacket', 'Silk slip skirt', 'Something for the office']

export default function BrowseClient() {
  const [draft, setDraft] = useState('')
  /** The question MYRA is answering. Set the moment she asks, so the bar lifts. */
  const [asked, setAsked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pieces, setPieces] = useState<BrowsePiece[] | null>(null)
  const [read, setRead] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const [picked, setPicked] = useState<string | null>(null)
  const [styling, setStyling] = useState<'wardrobe' | 'new' | null>(null)
  const [looks, setLooks] = useState<StyledLook[]>([])
  const [note, setNote] = useState<string | null>(null)

  const started = asked != null
  const chosen = pieces?.find((p) => p.item_id === picked) ?? null

  async function run(query: string) {
    const q = query.trim()
    if (!q) return
    setAsked(q); setDraft(q)
    setBusy(true); setPieces(null); setError(null)
    setPicked(null); setLooks([]); setNote(null)
    const r = await browseSearch(q)
    setBusy(false)
    setPieces(r.pieces); setRead(r.read); setError(r.error ?? null)
  }

  async function style(piece: BrowsePiece, mode: 'wardrobe' | 'new') {
    if (styling) return
    setStyling(mode); setLooks([]); setNote(null)
    const r = await styleBrowsedPiece(piece.item_id, mode)
    setStyling(null)
    setLooks(r.looks)
    setNote(r.error ?? (r.looks.length ? null : 'MYRA could not build a look around this one.'))
  }

  return (
    <div className="w-full">
      {/* The bar: middle of the page until she asks, then up out of the way. */}
      <div className={`transition-[padding] duration-500 ease-out ${started ? 'pt-0' : 'pt-[20vh]'}`}>
        <form onSubmit={(e) => { e.preventDefault(); void run(draft) }} className="relative w-full max-w-[760px] mx-auto px-1">
          <button type="submit" aria-label="Search" className="absolute left-5 top-1/2 -translate-y-1/2 p-1 text-[#55534E] hover:text-[#2B2B2B]">
            <svg viewBox="0 0 17 16" fill="none" className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden>
              <path d="M7.667 12.667A5.333 5.333 0 107.667 2a5.333 5.333 0 000 10.667zM14.334 14l-2.9-2.9" stroke="currentColor" strokeWidth="1.333" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search better through MYRA"
            aria-label="Search through MYRA"
            data-tour="browse-search"
            type="text"
            className="w-full rounded-full bg-white border-2 border-transparent shadow-md transition-all duration-300 focus:outline-none focus:border-[#2B2B2B] text-[#2B2B2B] placeholder:text-[#8C8A85] text-[17px] sm:text-[clamp(19px,1.3vw,26px)] pl-16 pr-14 py-4"
          />
          {draft && (
            <button type="button" onClick={() => setDraft('')} aria-label="Clear search" className="absolute right-5 top-1/2 -translate-y-1/2 p-1 text-[#55534E] hover:text-[#2B2B2B]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </form>

        {!started && (
          <>
            <p className="myra-guide-text normal-case text-center text-[18px] sm:text-[21px] text-[#6E6B65] mt-5">
              Ask in your own words. MYRA reads the colour, the piece and the occasion, then finds it.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void run(p)}
                  className="text-[15px] tracking-[0.04em] rounded-full border border-[rgba(43,43,43,0.25)] px-4 py-2 text-[#2B2B2B] hover:bg-white"
                >
                  {p}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* MYRA looking: the mirror it always waits with. */}
      {busy && (
        <div className="mt-14 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-28 sm:h-40 w-auto mx-auto" />
          <p className="mt-5 text-[15px] tracking-[0.16em] text-[#6E6B65]">MYRA IS LOOKING…</p>
        </div>
      )}

      {error && !busy && <p className="text-[17px] text-[#B83A3A] mt-8">{error}</p>}

      {!busy && pieces && (
        <div className="mt-10">
          {read.length > 0 && (
            <p className="text-[14px] tracking-[0.16em] text-[#6E6B65] mb-5">READ AS {read.join(' · ')}</p>
          )}
          {pieces.length === 0 ? (
            <p className="myra-guide-text normal-case text-[19px] text-[#4A4E57]">Nothing for that yet. Try it another way.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {pieces.map((p) => (
                <button
                  key={p.item_id}
                  type="button"
                  onClick={() => { setPicked(p.item_id); setLooks([]); setNote(null) }}
                  className={`text-left bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)] transition-shadow ${picked === p.item_id ? 'ring-2 ring-[#2B2B2B]' : ''}`}
                >
                  <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                    {p.image_url && <FallbackImage src={p.image_url} thumbWidth={600} alt={p.product_name} className="absolute inset-0 w-full h-full object-cover" />}
                  </div>
                  <div className="px-3 py-2.5">
                    {p.brand && <p className="text-[12px] tracking-[0.12em] text-[#6E6B65] truncate">{p.brand.toUpperCase()}</p>}
                    <p className="text-[15px] text-[#2B2B2B] leading-tight truncate">{p.product_name}</p>
                    {p.price_gbp != null && <p className="text-[13px] text-[#6E6B65] mt-0.5">£{Math.round(p.price_gbp)}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The piece she picked, and the two ways to see it. */}
      {chosen && !busy && (
        <section className="mt-9 rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-6 sm:px-8 py-7">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[15px] tracking-[0.14em] text-[#2B2B2B] mr-auto">
              {(chosen.brand ? `${chosen.brand} · ` : '') + chosen.product_name.toUpperCase()}
            </p>
            <button
              type="button"
              onClick={() => void style(chosen, 'wardrobe')}
              disabled={!!styling}
              className="text-[15px] tracking-[0.06em] rounded-full bg-[#2B2B2B] text-white px-6 py-3 disabled:opacity-40"
            >
              {styling === 'wardrobe' ? 'BUILDING…' : 'STYLE IT WITH MY WARDROBE'}
            </button>
            <button
              type="button"
              onClick={() => void style(chosen, 'new')}
              disabled={!!styling}
              className="text-[15px] tracking-[0.06em] rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-6 py-3 disabled:opacity-40"
            >
              {styling === 'new' ? 'BUILDING…' : 'STYLE IT WITH SOMETHING NEW'}
            </button>
            {chosen.url && (
              <a href={chosen.url} target="_blank" rel="noopener noreferrer" className="text-[15px] tracking-[0.1em] text-[#2B2B2B] underline underline-offset-4">
                SEE IT
              </a>
            )}
          </div>

          {styling && (
            <div className="rounded-[16px] bg-white/70 px-6 py-10 text-center mt-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-24 w-auto mx-auto" />
              <p className="mt-4 text-[17px] text-[#4A4E57]">
                {styling === 'wardrobe' ? 'Looking through your wardrobe…' : 'Finding something new for it…'}
              </p>
            </div>
          )}

          {note && !styling && <p className="myra-guide-text normal-case text-[18px] text-[#4A4E57] mt-5">{note}</p>}

          {looks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-6">
              {looks.map((l, i) => <ComposedLookCard key={l.look_id ?? i} look={l} heroId={chosen.item_id} />)}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

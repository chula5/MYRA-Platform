'use client'

// ONE OF HER PIECES — how it has been styled, and new ways to wear it:
// STYLE THIS for an occasion, or FIND SKIRTS TO GO WITH IT. Outfits come from
// the same composer and look check as a delivery; nothing is saved.

import { useState } from 'react'
import Link from 'next/link'
import FallbackImage from '@/components/FallbackImage'
import type { OwnedPieceView, StyledLook } from '@/app/admin/private-stylist/actions'
import { styleMyPiece } from './actions'

export default function PieceClient({
  view, testMemberId, onBack,
}: {
  view: OwnedPieceView
  testMemberId?: string
  onBack?: () => void
}) {
  const piece = view.piece
  const [asked, setAsked] = useState<string | null>(null)
  const [results, setResults] = useState<StyledLook[] | null>(null)
  const [hidden, setHidden] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(label: string, opts: { occasion?: string; withType?: string }) {
    if (!piece) return
    setAsked(label)
    setBusy(true)
    setError(null)
    setResults(null)
    const r = await styleMyPiece(piece.item_id, opts, testMemberId)
    setBusy(false)
    setResults(r.looks)
    setHidden(r.hidden ?? 0)
    if (r.error) setError(r.error)
  }

  const back = onBack
    ? <button onClick={onBack} className="text-[22px] text-[#2B2B2B] underline underline-offset-4">← Your dressing room</button>
    : <Link href="/me/dressing-room" className="text-[22px] text-[#2B2B2B] underline underline-offset-4">← Your dressing room</Link>

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 py-10 max-w-[1600px] mx-auto space-y-14">
        {back}
        {!piece ? (
          <p className="text-[22px] text-[#B83A3A]">{view.error ?? 'That piece is not in your wardrobe.'}</p>
        ) : (
          <>
            <section className="grid grid-cols-1 md:grid-cols-[minmax(0,420px)_1fr] gap-8 items-start">
              <div className="relative aspect-[3/4] bg-white overflow-hidden rounded-[14px]">
                {piece.image_url && <FallbackImage src={piece.image_url} thumbWidth={900} alt={piece.product_name} className="absolute inset-0 w-full h-full object-contain" />}
              </div>
              <div className="space-y-4">
                <p className="myra-section-note">YOUR OWN PIECE</p>
                <h1 className="text-[clamp(28px,4vw,56px)] tracking-[0.03em] text-[#2B2B2B] leading-[1.1]">{piece.product_name}</h1>
                <p className="text-[22px] text-[#55534E]">
                  {piece.styled_in ? `Styled in ${piece.styled_in} look${piece.styled_in === 1 ? '' : 's'} so far.` : 'Not styled yet — try it below.'}
                </p>
                {view.test && <p className="text-[18px] tracking-[0.1em] text-[#8B5E00]">TEST AS {view.firstName.toUpperCase()} — NOTHING IS SAVED</p>}
              </div>
            </section>

            {/* STYLE THIS */}
            <section className="space-y-5">
              <h2 className="myra-section-label">STYLE THIS</h2>
              <p className="text-[22px] text-[#2B2B2B]">What are you wearing it for?</p>
              <div className="flex flex-wrap gap-3">
                {view.occasions.map((o) => (
                  <button
                    key={o.id}
                    disabled={busy}
                    onClick={() => run(o.label, { occasion: o.id })}
                    className={`text-[22px] px-6 py-3.5 border transition-colors disabled:opacity-50 ${asked === o.label ? 'bg-[#2B2B2B] border-[#2B2B2B] text-white' : 'border-[#2B2B2B] text-[#2B2B2B] hover:bg-[#2B2B2B] hover:text-white'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {view.finders.length > 0 && (
                <>
                  <p className="text-[22px] text-[#2B2B2B] pt-2">Or find something to go with it:</p>
                  <div className="flex flex-wrap gap-3">
                    {view.finders.map((f) => {
                      const label = `Find ${f.label} to go with it`
                      return (
                        <button
                          key={f.itemType}
                          disabled={busy}
                          onClick={() => run(label, { withType: f.itemType })}
                          className={`text-[22px] px-6 py-3.5 border transition-colors disabled:opacity-50 ${asked === label ? 'bg-[#2B2B2B] border-[#2B2B2B] text-white' : 'border-[#2B2B2B] text-[#2B2B2B] hover:bg-[#2B2B2B] hover:text-white'}`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {busy && <p className="text-[22px] text-[#55534E]">Putting outfits together and checking them…</p>}
              {error && <p className="text-[22px] text-[#B83A3A]">{error}</p>}
              {results && results.length > 0 && (
                <div className="space-y-3">
                  <p className="myra-section-note">{asked?.toUpperCase()}</p>
                  {view.test && hidden > 0 && (
                    <p className="text-[18px] text-[#8B5E00]">{hidden} more outfit{hidden === 1 ? ' was' : 's were'} composed and not shown — they failed the look check or her size.</p>
                  )}
                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    {results.map((l, i) => <OutfitCard key={i} look={l} heroId={piece.item_id} />)}
                  </div>
                </div>
              )}
            </section>

            {/* HOW IT HAS BEEN STYLED */}
            <section className="space-y-5">
              <h2 className="myra-section-label">HOW IT&rsquo;S BEEN STYLED</h2>
              {view.styled.length === 0 ? (
                <p className="text-[22px] text-[#55534E]">No looks with this piece yet.</p>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  {view.styled.map((l) => <OutfitCard key={l.look_id ?? ''} look={l} heroId={piece.item_id} />)}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function OutfitCard({ look, heroId }: { look: StyledLook; heroId: string }) {
  return (
    <article className="bg-[#F7F6F3] border border-[#2B2B2B]">
      {look.image_url ? (
        <div className="relative aspect-[3/4] bg-[#E4E2DD] overflow-hidden rounded-[14px]">
          <FallbackImage src={look.image_url} thumbWidth={700} alt="" className="absolute inset-0 w-full h-full object-cover" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-[4px] p-[4px] bg-[#E4E2DD]">
          {look.items.map((it, j) => (
            <div key={j} className={`relative aspect-[3/4] bg-white overflow-hidden ${it.item_id === heroId ? 'outline outline-2 outline-[#2B2B2B]' : ''}`}>
              {it.image_url && <FallbackImage src={it.image_url} thumbWidth={300} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain" />}
            </div>
          ))}
        </div>
      )}
      <div className="px-5 py-5 space-y-3">
        <p className="text-[22px] leading-snug text-[#2B2B2B]">{look.why}</p>
        <p className="text-[18px] text-[#6E6B65]">
          {look.items.map((it) => (it.owned ? `your ${it.product_name.toLowerCase()}` : it.product_name)).join(' · ')}
        </p>
      </div>
    </article>
  )
}

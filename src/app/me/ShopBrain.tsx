'use client'

// MYRA WORKED WHILE YOU SHOPPED.
//
// Three answers to a question she has not asked yet, sitting above her looks:
// more like the pieces she kept out there, more from the labels she was
// reading, and those pieces already styled. She hearts something on a brand's
// own site and by the time she opens MYRA the thinking has been done.
//
// Each answer is one card — a cover picture and a clear title. Hover and the
// card turns over to show a grid of what is inside; tap and the whole section
// opens underneath as a grid she can shop or style from.
//
// It draws nothing at all until she has kept something — an empty promise is
// worse than no promise.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import FallbackImage from '@/components/FallbackImage'
import ShopLink from '@/components/ShopLink'
import ComposedLookCard from '@/components/me/ComposedLookCard'
import { useScrollTo } from '@/lib/smooth-scroll'
import { loadShopBrain, styleSavedPieceFor, type ShopBrainView, type ShopPiece } from './shop-brain-actions'
import type { StyledLook } from '@/app/admin/private-stylist/actions'

type Door = 'similar' | 'brands' | 'styled'

const HEAD = 'myra-section-label'
const NOTE = 'myra-section-note mt-1.5'
const FLIP = 'transition-transform duration-[600ms] [transition-timing-function:cubic-bezier(0.175,0.885,0.32,1.275)]'

function Piece({ piece }: { piece: ShopPiece }) {
  const body = (
    <>
      <div className="relative aspect-[3/4] bg-white overflow-hidden rounded-[14px]">
        {piece.image_url && (
          <FallbackImage src={piece.image_url} thumbWidth={400} alt={piece.product_name} className="absolute inset-0 w-full h-full object-contain" />
        )}
      </div>
      <p className="mt-3 text-[19px] xl:text-[22px] text-[#2B2B2B] leading-[1.2]">{piece.brand ?? piece.product_name}</p>
      <p className="text-[17px] xl:text-[19px] text-[#7C838B] leading-[1.25] line-clamp-1">{piece.product_name}</p>
      {piece.price_gbp != null && <p className="text-[17px] xl:text-[19px] text-[#7C838B]">£{Math.round(piece.price_gbp)}</p>}
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

const PIECE_GRID = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-6 gap-y-10'

// ONE OUTFIT, small — her picture when the look has one, otherwise its
// pieces two by two on white, the piece it was built around first.
function LookThumb({ look, heroId }: { look: StyledLook; heroId?: string }) {
  if (look.image_url) {
    return (
      <div className="relative aspect-[3/4] bg-[#E4E2DD] rounded-[10px] overflow-hidden">
        <FallbackImage src={look.image_url} thumbWidth={360} alt="" className="absolute inset-0 w-full h-full object-cover" />
      </div>
    )
  }
  const items = [...look.items].sort((a, b) => (a.item_id === heroId ? -1 : b.item_id === heroId ? 1 : 0)).slice(0, 4)
  return (
    <div className="aspect-[3/4] grid grid-cols-2 grid-rows-2 gap-[3px] p-[3px] bg-[#E4E2DD] rounded-[10px] overflow-hidden">
      {items.map((it, j) => (
        <div key={j} className="relative bg-white overflow-hidden">
          {it.image_url && <FallbackImage src={it.image_url} thumbWidth={200} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain p-[2px]" />}
        </div>
      ))}
    </div>
  )
}

// THREE OUTFITS for one of her pieces, side by side — or quiet placeholders
// while MYRA is still putting them together.
function ThreeLooks({ looks, heroId, working, note }: { looks?: StyledLook[]; heroId?: string; working?: boolean; note?: string }) {
  if (looks?.length) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {looks.slice(0, 3).map((l, i) => <LookThumb key={i} look={l} heroId={heroId} />)}
      </div>
    )
  }
  if (note && !working) return <p className="text-[17px] xl:text-[19px] text-[#55534E] py-2">{note}</p>
  return (
    <div className="grid grid-cols-3 gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="aspect-[3/4] rounded-[10px] bg-gradient-to-r from-[#E9E9E7] via-[#F4F4F2] to-[#E9E9E7] animate-pulse" />
      ))}
    </div>
  )
}

// ONE OF HER PIECES in the open section: the piece on white; hover and its
// three outfits turn up over it, the same way the doors turn.
function StyledPiece({ piece, looks, working, note, active, onPick }: {
  piece: ShopPiece; looks?: StyledLook[]; working: boolean; note?: string; active: boolean; onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`See your ${piece.brand ?? piece.product_name} styled`}
      className={`group block w-full text-left outline-none focus:outline-none`}
    >
      <div className={`relative aspect-[3/4] bg-white rounded-[18px] overflow-hidden [perspective:1000px] shadow-[0_2px_14px_rgba(43,43,43,0.06)] ${active ? 'shadow-[0_4px_22px_rgba(43,43,43,0.16)]' : ''}`}>
        {piece.image_url && <FallbackImage src={piece.image_url} thumbWidth={600} alt={piece.product_name} className="absolute inset-0 w-full h-full object-contain p-6" />}
        <div className={`absolute inset-0 bg-[#F2F2F2] p-3 flex flex-col justify-center origin-bottom [transform:rotateX(-90deg)]
          group-hover:[transform:rotateX(0deg)] group-focus-visible:[transform:rotateX(0deg)] motion-reduce:transition-none ${FLIP}`}>
          <ThreeLooks looks={looks} heroId={piece.item_id} working={working} note={note} />
        </div>
      </div>
      <p className="mt-3 text-[19px] xl:text-[22px] text-[#2B2B2B] leading-[1.2]">{piece.brand ?? piece.product_name}</p>
      <p className="text-[17px] xl:text-[19px] text-[#7C838B] leading-[1.25] line-clamp-1">{piece.product_name}</p>
    </button>
  )
}

// ONE DOOR — a portrait card in the MYRA shape. The front is a cover picture
// with the title in a white band; on hover the inside turns up from the
// bottom edge, a small grid of what she will find behind it.
function Door({
  title, cover, coverFit = 'contain', inside, insideNode, open, onOpen, empty,
}: {
  title: string
  cover: string | null
  coverFit?: 'contain' | 'cover'
  inside: (string | null)[]
  /** Replaces the picture grid when the inside is something richer. */
  insideNode?: ReactNode
  open: boolean
  onOpen: () => void
  empty?: string
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      className={`group relative w-full aspect-[3/4] rounded-[24px] overflow-hidden bg-white text-left
        [perspective:1000px] shadow-[0_2px_18px_rgba(43,43,43,0.07)]
        hover:scale-[1.03] focus-visible:scale-[1.03] outline-none focus:outline-none ${FLIP}`}
    >
      {/* Front: the cover and the title. */}
      <div className="absolute inset-0 bg-white">
        {cover ? (
          <FallbackImage src={cover} thumbWidth={900} alt="" className={`absolute inset-0 w-full h-full ${coverFit === 'cover' ? 'object-cover' : 'object-contain p-10'}`} />
        ) : (
          <p className="absolute inset-x-6 bottom-10 text-center text-[19px] text-[#55534E]">{empty}</p>
        )}
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <p className="bg-[rgba(255,255,255,0.88)] backdrop-blur-[2px] rounded-full px-8 py-4 text-center text-[clamp(26px,2.6vw,52px)] tracking-[0.05em] leading-[1.05] text-[#2B2B2B]">
            {title}
          </p>
        </div>
      </div>

      {/* Inside: turns up from the bottom edge on hover, a grid of what is in here. */}
      {(inside.length > 0 || insideNode) && (
        <div
          className={`absolute inset-0 bg-[#F2F2F2] p-5 md:p-6 flex flex-col origin-bottom [transform:rotateX(-90deg)]
            group-hover:[transform:rotateX(0deg)] group-focus-visible:[transform:rotateX(0deg)] motion-reduce:transition-none ${FLIP}`}
        >
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <p className="text-[clamp(20px,1.6vw,32px)] tracking-[0.05em] text-[#2B2B2B] leading-[1.05]">{title}</p>
            <p className="text-[clamp(15px,1vw,19px)] tracking-[0.14em] text-[#7C838B] whitespace-nowrap">OPEN →</p>
          </div>
          {insideNode ?? (
            <div className="grid grid-cols-3 gap-3 flex-1 content-start">
              {inside.slice(0, 9).map((src, i) => (
                <div key={i} className="relative aspect-[3/4] bg-white rounded-[10px] overflow-hidden">
                  {src && <FallbackImage src={src} thumbWidth={240} alt="" className="absolute inset-0 w-full h-full object-contain p-1" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </button>
  )
}

export default function ShopBrain({ testMemberId }: { testMemberId?: string }) {
  const [view, setView] = useState<ShopBrainView | null>(null)
  const [door, setDoor] = useState<Door | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [looks, setLooks] = useState<Record<string, StyledLook[]>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<Record<string, string>>({})
  const queued = useRef(false)
  const openRef = useRef<HTMLDivElement>(null)
  const scrollTo = useScrollTo()

  useEffect(() => { void loadShopBrain(testMemberId).then(setView) }, [testMemberId])

  // The pieces she kept are styled without being asked — three outfits each,
  // newest first, one after another — so the work is done before she looks.
  const STYLE_AHEAD = 6
  const done = useRef<Set<string>>(new Set())
  async function style(itemId: string) {
    if (done.current.has(itemId)) return
    done.current.add(itemId)
    setBusy(itemId)
    const r = await styleSavedPieceFor(itemId, testMemberId).catch(() => ({ looks: [] as StyledLook[], error: 'MYRA could not style this one just now.' }))
    setBusy((b) => (b === itemId ? null : b))
    if (r.error || !r.looks.length) {
      setFailed((f) => ({ ...f, [itemId]: r.error ?? 'Nothing MYRA would put with it yet.' }))
      return
    }
    setLooks((l) => ({ ...l, [itemId]: r.looks }))
  }
  useEffect(() => {
    if (!view?.saved.length || queued.current) return
    queued.current = true
    setAnchor((a) => a ?? view.saved[0].item_id)
    void (async () => {
      for (const s of view.saved.slice(0, STYLE_AHEAD)) await style(s.item_id)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  function toggle(d: Door) {
    const next = door === d ? null : d
    setDoor(next)
    if (next) setTimeout(() => { if (openRef.current) scrollTo(openRef.current, { offset: -24 }) }, 50)
  }

  if (!view || (!view.saved.length && !view.similar.length && !view.fromBrands.length)) return null
  const doors = view.saved.length ? 3 : 2

  const labels = view.brands.slice(0, 2)
  const brandLine = labels.length ? labels.join(' & ').toUpperCase() : 'THOSE LABELS'
  const current = anchor ? view.saved.find((s) => s.item_id === anchor) ?? view.saved[0] : view.saved[0]
  const shown = current ? looks[current.item_id] : undefined
  const brandsTitle = view.fromBrandsKind === 'same' ? `MORE FROM ${brandLine}` : `LIKE ${brandLine}`
  const brandsNote = view.fromBrandsKind === 'same' ? 'THE LABELS YOU WERE READING' : `MYRA DOESN'T STOCK ${brandLine} — THESE STAND BESIDE IT`
  const firstLook = current ? looks[current.item_id]?.[0] : undefined
  const styledCover = firstLook?.image_url ?? current?.image_url ?? null
  const styledInside = view.saved.slice(0, 9).map((s) => s.image_url ?? null)
  const styledBoxes = (
    <div data-lenis-prevent className="flex-1 min-h-0 overflow-hidden space-y-3">
      {view.saved.slice(0, 3).map((s) => (
        <div key={s.item_id} className="bg-white rounded-[14px] p-2.5 flex gap-2.5 items-stretch">
          <div className="relative w-[22%] flex-none aspect-[3/4] self-center">
            {s.image_url && <FallbackImage src={s.image_url} thumbWidth={200} alt={s.product_name} className="absolute inset-0 w-full h-full object-contain" />}
          </div>
          <div className="flex-1 min-w-0">
            <ThreeLooks looks={looks[s.item_id]} heroId={s.item_id} working={busy === s.item_id || !done.current.has(s.item_id)} note={failed[s.item_id]} />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <section className="mb-20 pt-2">
      <div className="text-center mb-10 lg:mb-12">
        <p className={HEAD}>MYRA WORKED WHILE YOU SHOPPED</p>
        {view.fromLooking && <p className="myra-section-note mt-3">FROM WHAT YOU LOOKED AT{view.searches.length ? ' AND SEARCHED FOR' : ''}</p>}
      </div>

      {/* The three doors. */}
      <div className={`grid grid-cols-1 ${doors === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-8 lg:gap-12 2xl:gap-16 w-full px-2 sm:px-4 lg:px-8`}>
        <Door
          title="MORE OF THE SAME"
          cover={view.similar[0]?.image_url ?? null}
          inside={view.similar.slice(0, 9).map((p) => p.image_url ?? null)}
          open={door === 'similar'} onOpen={() => toggle('similar')}
          empty="Nothing close enough yet."
        />
        <Door
          title={brandsTitle}
          cover={view.fromBrands[0]?.image_url ?? null}
          inside={view.fromBrands.slice(0, 9).map((p) => p.image_url ?? null)}
          open={door === 'brands'} onOpen={() => toggle('brands')}
          empty={`Nothing from ${labels.length ? labels.join(' or ') : 'those labels'} yet.`}
        />
        {view.saved.length > 0 && <Door
          title="STYLED FOR YOU"
          cover={styledCover} coverFit={firstLook?.image_url ? 'cover' : 'contain'}
          inside={styledInside}
          insideNode={styledBoxes}
          open={door === 'styled'} onOpen={() => toggle('styled')}
        />}
      </div>

      {/* The open door: the whole section as a grid. */}
      {door && (
        <div ref={openRef} className="mt-14 mx-2 sm:mx-4 lg:mx-8 rounded-[24px] bg-white/85 shadow-[0_2px_18px_rgba(43,43,43,0.07)] px-6 md:px-10 py-9 scroll-mt-6">
          <div className="flex items-start justify-between gap-6 mb-6">
            <div>
              <p className={HEAD}>{door === 'similar' ? 'MORE OF THE SAME' : door === 'brands' ? brandsTitle : 'STYLED FOR YOU'}</p>
              <p className={NOTE}>
                {door === 'similar' ? 'CLOSE TO WHAT YOU KEPT' : door === 'brands' ? brandsNote : 'HOVER A PIECE FOR ITS OUTFITS · TAP TO SEE THEM FULL SIZE'}
              </p>
            </div>
            <button type="button" onClick={() => setDoor(null)} aria-label="Close" className="text-[19px] tracking-[0.14em] text-[#4A4E57] underline underline-offset-4 whitespace-nowrap">
              CLOSE
            </button>
          </div>

          {door === 'similar' && (
            view.similar.length ? (
              <>
                <div className={PIECE_GRID}>{view.similar.map((p) => <Piece key={p.item_id} piece={p} />)}</div>
                {view.similar[0]?.because && <p className="text-[15px] text-[#7C838B] mt-5">{view.similar[0].because}.</p>}
              </>
            ) : (
              <p className="text-[19px] text-[#55534E]">Nothing close enough yet — MYRA would rather show you nothing than something near it.</p>
            )
          )}

          {door === 'brands' && (
            view.fromBrands.length ? (
              <div className={PIECE_GRID}>{view.fromBrands.map((p) => <Piece key={p.item_id} piece={p} />)}</div>
            ) : (
              <p className="text-[19px] text-[#55534E]">Nothing from {labels.length ? labels.join(' or ') : 'those labels'} or their neighbours yet. MYRA is watching them.</p>
            )
          )}

          {door === 'styled' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-6 gap-y-10">
                {view.saved.map((s) => (
                  <StyledPiece
                    key={s.item_id}
                    piece={s}
                    looks={looks[s.item_id]}
                    working={busy === s.item_id || !done.current.has(s.item_id)}
                    note={failed[s.item_id]}
                    active={current?.item_id === s.item_id}
                    onPick={() => { setAnchor(s.item_id); void style(s.item_id) }}
                  />
                ))}
              </div>

              {current && (
                <p className="text-[21px] xl:text-[24px] text-[#2B2B2B] mt-12">
                  {current.brand ?? current.product_name}
                  {current.host ? <span className="text-[#7C838B]"> · {current.kind === 'viewed' ? 'you looked at this on ' : ''}{current.host}</span> : null}
                </p>
              )}

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {shown ? (
                  shown.map((l, i) => <ComposedLookCard key={i} look={l} heroId={current?.item_id} />)
                ) : current && !failed[current.item_id] ? (
                  [0, 1, 2].map((i) => (
                    <div key={i} className="h-[260px] rounded-[18px] bg-gradient-to-r from-[#EFEFED] via-[#F7F7F5] to-[#EFEFED]" />
                  ))
                ) : (
                  <p className="text-[19px] text-[#55534E]">{(current && failed[current.item_id]) ?? 'Tap a piece to see it styled.'}</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

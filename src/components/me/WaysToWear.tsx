'use client'

// THE PIECE, IN THE MIRROR — one piece, pinned, and everything MYRA has for it.
//
// The same sheet on every surface a piece can be tapped from: Browse, FOR YOU,
// the sale, a piece she kept, a piece inside an outfit, a stylist's answer,
// a hotspot on one of her looks. In it, before she ever leaves MYRA:
//   · its pictures — the library's, the shop's others, MYRA's model shot
//   · TRY ON MY AVATAR — the piece on her own avatar
//   · FROM THE STUDIO — the outfits Chloe's studio has already made with it
//   · MYRA's ways — outfits built around it on ask, with something new or
//     with her own wardrobe, each through MYRA's eye before it is drawn
//   · VIEW ON SITE — the shop, as the last step, not the first
// (Chloe, 2026-11-08 and 2026-11-11: "see it in MYRA first".)
//
// What MYRA already keeps for the piece shows at once; when there is nothing
// yet, three slots wait and each fills the moment that look has been through
// MYRA's eye. Nothing unchecked is ever drawn. Closing the sheet does not stop
// the work: the piece she left shows a small mark when it lands.
//
// Every outfit is drawn by BuiltOutfit, so each piece can be swapped (search,
// brand, type, colour) and undone, as everywhere else she builds outfits —
// and tapped, to open in a sheet of its own over this one.

import { useEffect, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import BuiltOutfit from '@/app/me/dressing-room/BuiltOutfit'
import ComposedLookCard from '@/components/me/ComposedLookCard'
import type { StudioLook } from '@/lib/studio-looks'
import SaveOutfit from '@/components/me/SaveOutfit'
import ShareWithFriend from '@/components/me/ShareWithFriend'
import ShopLink from '@/components/ShopLink'
import TryOnAvatarButton from '@/components/me/TryOnAvatarButton'
import type { LookItem } from '@/lib/pilot-stylist'
import { openWaysToWear, pollWaysToWear, reactToWay, pieceGalleryFor, type WaysPiece, type WaysStatus } from '@/app/me/ways/actions'
import type { PieceGallery } from '@/lib/piece-gallery'
import { WAYS, type StyledWayLook, type WayMode } from '@/lib/styled-ways-core'
import { watchWays, clearWaysReady } from './ways-watch'
import { journeySignal } from '@/lib/journey'

const T = 'text-[19px] xl:text-[22px] 2xl:text-[26px]'
const T_SMALL = 'text-[17px] xl:text-[20px] 2xl:text-[23px]'
const PILL_DARK = `${T_SMALL} px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white`
const PILL_LIGHT = `${T_SMALL} px-5 py-2.5 rounded-full border border-[#2B2B2B] text-[#2B2B2B]`
// The sheet never gives up on its own: MYRA finishes or says it cannot, and
// the queue (lib/styled-ways-queue) fails a job whose function died. It only
// asks less often as the wait grows, and after five minutes says so in a
// calmer voice — the mark in the corner carries on when she leaves.
const POLL_MS = 1_500

/** The outfit as a friend receives it: the pieces, their links and prices, MYRA's picture if there is one. */
function lookAttachment(items: LookItem[], imageUrl: string | null | undefined, occasion: string | null | undefined) {
  return {
    kind: 'look' as const, image_url: imageUrl ?? null, occasion_label: occasion ?? null,
    items: items.map((it) => ({ brand: it.brand, product_name: it.product_name, image_url: it.image_url ?? null, url: it.url ?? null, price_gbp: it.price_gbp ?? null, item_id: it.item_id ?? null })),
  }
}
const SLOW_AFTER_MS = 60_000
const SLOW_POLL_MS = 3_000
const PATIENT_AFTER_MS = 5 * 60_000
const PATIENT_POLL_MS = 10_000

/** What each way of building is called, on the chips and over the outfits. */
const MODE_LABEL: Record<WayMode, string> = { blend: 'WITH SOMETHING NEW', inspiration: 'WITH SOMETHING NEW', wardrobe: 'WITH MY WARDROBE' }

export default function WaysToWear({
  itemId, piece, mode = 'blend', testMemberId, onClose, inline = false, heading, autoStart = true, startLabel, onStatus,
}: {
  itemId: string
  /** What to pin while the first answer loads; the server's own copy replaces it. */
  piece?: Partial<WaysPiece> | null
  mode?: WayMode
  testMemberId?: string
  onClose?: () => void
  /** Drawn in the page rather than over it. */
  inline?: boolean
  heading?: string
  /** False: show what is kept and wait to be asked (a rest on a piece, not a tap). */
  autoStart?: boolean
  /** What the button says while the sheet waits to be asked (autoStart false). */
  startLabel?: string
  /** Where the sheet has got to, and how many ways have landed — for a page that shows its own progress mark. */
  onStatus?: (status: WaysStatus | 'opening', landed: number) => void
}) {
  const [looks, setLooks] = useState<StyledWayLook[]>([])
  // What the studio already made with it: drawn first, before MYRA's own ways.
  const [studio, setStudio] = useState<StudioLook[]>([])
  const [status, setStatus] = useState<WaysStatus | 'opening'>('opening')
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<WaysPiece | null>(null)
  const [test, setTest] = useState(false)
  // How she asked for the outfits: with something new, or with what she owns.
  // A sheet opened on a piece (autoStart false) lets her choose; a sheet a
  // page opened already styling keeps the mode it was given.
  const [wayMode, setWayMode] = useState<WayMode>(mode)
  const modeRef = useRef<WayMode>(mode)
  // Its pictures: the shop's others and MYRA's model shot, fetched once the sheet has drawn.
  const [gallery, setGallery] = useState<PieceGallery | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  // What each way looks like after her swaps — what SAVE keeps.
  const [edited, setEdited] = useState<Record<string, LookItem[]>>({})
  // Her verdicts this sitting: a like is saved at once (the look id), a dislike is gone.
  const [liked, setLiked] = useState<Record<string, string>>({})
  const [reacting, setReacting] = useState<string | null>(null)
  // A piece tapped inside one of the outfits: its own sheet opens over this one,
  // what the studio made with it first, MYRA's ways on ask (Chloe, 2026-11-08).
  const [waysFor, setWaysFor] = useState<WaysPiece | null>(null)

  async function react(l: StyledWayLook, reaction: 'like' | 'dislike') {
    if (reacting) return
    setReacting(l.styled_way_id)
    if (reaction === 'dislike') setLooks((cur) => cur.filter((x) => x.styled_way_id !== l.styled_way_id))
    try {
      const r = await reactToWay(l.styled_way_id, reaction, testMemberId)
      if (!live.current) return
      if (reaction === 'like' && r.lookId) setLiked((m) => ({ ...m, [l.styled_way_id]: r.lookId as string }))
      if (r.error) setError(r.error)
    } finally { if (live.current) setReacting(null) }
  }
  const startedAt = useRef(0)
  const [slow, setSlow] = useState(false)
  const live = useRef(true)
  const working = useRef(false)

  // Every way into a piece — saved, dressing room, browse, a link — ends here,
  // so this is where the JOURNEY learns which piece she opened.
  useEffect(() => {
    if (testMemberId) return
    journeySignal({
      type: 'item_open',
      target_kind: 'item',
      target_id: itemId,
      label: [piece?.brand, piece?.product_name].filter(Boolean).join(' — ') || null,
      meta: { brand: piece?.brand ?? null, mode },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  async function poll() {
    if (!live.current) return
    let next: Awaited<ReturnType<typeof pollWaysToWear>> | null = null
    try { next = await pollWaysToWear(itemId, modeRef.current, testMemberId) } catch { /* try again */ }
    if (!live.current) return
    if (next) {
      setLooks(next.looks)
      if (next.status !== 'working' || next.looks.length >= WAYS) {
        working.current = false
        setStatus(next.looks.length ? 'ready' : next.status)
        if (next.error && !next.looks.length) setError(next.error)
        return
      }
    }
    const elapsed = Date.now() - startedAt.current
    if (elapsed >= PATIENT_AFTER_MS) setSlow(true)
    setTimeout(poll, elapsed >= PATIENT_AFTER_MS ? PATIENT_POLL_MS : elapsed >= SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS)
  }

  async function open(more: boolean, passive = false, inMode: WayMode = modeRef.current) {
    modeRef.current = inMode
    setWayMode(inMode)
    setError(null)
    setStatus(more ? 'working' : 'opening')
    startedAt.current = Date.now()
    setSlow(false)
    const v = await openWaysToWear(itemId, { mode: inMode, more, passive }, testMemberId)
    if (!live.current || modeRef.current !== inMode) return
    if (v.piece) setShown(v.piece)
    setTest(!!v.test)
    setLooks(v.looks)
    if (v.studio) setStudio(v.studio)
    if (v.error && v.status !== 'working') setError(v.error)
    setStatus(v.status)
    if (v.status === 'working') { working.current = true; setTimeout(poll, POLL_MS) }
  }

  /** Her choice of how to build: kept ways in that mode show at once, new ones are asked for. */
  function choose(next: WayMode) {
    if (next === modeRef.current && status !== 'idle') return
    setLooks([]); setEdited({})
    clearWaysReady(itemId, next)
    void open(false, false, next)
  }

  useEffect(() => {
    live.current = true
    modeRef.current = mode
    setWayMode(mode)
    clearWaysReady(itemId, mode)
    void open(false, !autoStart, mode)
    return () => {
      live.current = false
      if (working.current) watchWays(itemId, modeRef.current, testMemberId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, mode, testMemberId])
  useEffect(() => { onStatus?.(status, looks.length) }, [status, looks.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // Asked for after a passive open: start now.
  useEffect(() => {
    if (autoStart && status === 'idle') void open(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  // The other pictures of it, after the sheet has drawn. A slow shop costs
  // nothing here: the strip simply appears when it can.
  useEffect(() => {
    setGallery(null); setPhoto(null); setZoom(false)
    let on = true
    pieceGalleryFor(itemId, testMemberId).then((g) => { if (on && live.current) setGallery(g) }).catch(() => { /* one picture is fine */ })
    return () => { on = false }
  }, [itemId, testMemberId])

  const p = { ...(piece ?? {}), ...(shown ?? {}) } as Partial<WaysPiece>
  const busy = status === 'opening' || status === 'working'
  const slots = Math.max(WAYS, looks.length)
  const name = (p.brand ? `${p.brand} ` : '') + (p.product_name ?? '')
  // Every picture of it, in the order they are drawn: MYRA's model shot first, then the shop's.
  const pictures = [
    ...(gallery?.model_shot ? [{ url: gallery.model_shot, label: 'ON A MODEL' }] : []),
    ...((gallery?.photos.length ? gallery.photos : p.image_url ? [p.image_url] : []).map((url) => ({ url, label: null as string | null }))),
  ]
  const shownPhoto = photo ?? p.image_url ?? pictures[0]?.url ?? null
  // The sheet she opened herself chooses how to build; one a page opened already styling does not.
  const chooser = !autoStart && status !== 'opening'
  const modeChip = (m: WayMode, label: string) => {
    const on = wayMode === m && status !== 'idle'
    return (
      <button
        type="button"
        onClick={() => choose(m)}
        disabled={busy && !on}
        className={`${T_SMALL} px-5 py-2.5 rounded-full whitespace-nowrap disabled:opacity-40 ${on ? 'bg-[#2B2B2B] text-white' : 'border border-[#2B2B2B] text-[#2B2B2B]'}`}
        aria-pressed={on}
      >
        {label}
      </button>
    )
  }

  const body = (
    <div className={`w-full ${inline ? '' : 'px-6 sm:px-10 pt-[calc(40px+env(safe-area-inset-top,0px))] pb-10 max-w-[1700px] mx-auto'} space-y-8`}>
      <div className="flex items-start gap-5 flex-wrap">
        {/* The piece, large enough to see; a tap shows it full screen. */}
        <button
          type="button"
          onClick={() => shownPhoto && setZoom(true)}
          className="relative w-[128px] sm:w-[176px] flex-none aspect-[3/4] bg-white rounded-[12px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)]"
          aria-label={shownPhoto ? 'See the picture full screen' : undefined}
        >
          {shownPhoto && <FallbackImage src={shownPhoto} thumbWidth={600} alt={p.product_name ?? ''} className="absolute inset-0 w-full h-full object-contain" />}
        </button>
        <div className="flex-1 min-w-[200px] space-y-3">
          <div>
            <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>{heading ?? 'IN THE MIRROR'}</p>
            <p className={`${T} text-[#2B2B2B] leading-tight line-clamp-2`}>{name}</p>
            {typeof p.price_gbp === 'number' && <p className={`${T_SMALL} text-[#6E6B65] mt-0.5`}>£{Math.round(p.price_gbp)}</p>}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Her avatar wearing it: one tap makes the picture, the next shows it. */}
            {p.item_id && (
              <span className="inline-flex items-center gap-2">
                <TryOnAvatarButton itemId={p.item_id} className="relative" />
                <span className={`${T_SMALL} tracking-[0.1em] text-[#2B2B2B]`}>TRY ON MY AVATAR</span>
              </span>
            )}
            {p.url && p.item_id && (
              <ShopLink
                item={{ item_id: p.item_id, retailer_url: p.url, product_name: p.product_name, brand: p.brand ? { name: p.brand } : null }}
                className={PILL_LIGHT}
              >
                View on site
              </ShopLink>
            )}
            {onClose && (
              <button type="button" onClick={onClose} className={`${T_SMALL} text-[#6E6B65] underline underline-offset-4`}>
                {inline ? 'Close' : '← Back'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Its other pictures — the shop's, and MYRA's model shot — when there are any. */}
      {pictures.length > 1 && (
        <div data-lenis-prevent className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1">
          {pictures.map((pic, i) => (
            <button
              key={`${pic.url}-${i}`}
              type="button"
              onClick={() => setPhoto(pic.url)}
              className={`relative flex-none w-[64px] sm:w-[84px] aspect-[3/4] bg-white rounded-[10px] overflow-hidden ${shownPhoto === pic.url ? 'ring-2 ring-[#2B2B2B]' : 'ring-1 ring-[rgba(43,43,43,0.1)]'}`}
              aria-label={pic.label ? 'On a model' : `Picture ${i + 1}`}
            >
              <FallbackImage src={pic.url} thumbWidth={240} alt="" className="absolute inset-0 w-full h-full object-cover" />
              {pic.label && <span className="absolute inset-x-0 bottom-0 bg-[#2B2B2B]/85 text-white text-[10px] sm:text-[11px] tracking-[0.1em] text-center py-1">{pic.label}</span>}
            </button>
          ))}
        </div>
      )}

      {/* How to build with it: something new from the shops, or what she owns. */}
      {chooser && (
        <div className="flex items-center gap-3 flex-wrap">
          {modeChip('blend', status === 'idle' && wayMode !== 'wardrobe' ? (startLabel ?? 'Build outfits with it') : MODE_LABEL.blend)}
          {modeChip('wardrobe', MODE_LABEL.wardrobe)}
          {status === 'ready' && (
            <button type="button" onClick={() => void open(true)} className={PILL_DARK}>
              More ways
            </button>
          )}
        </div>
      )}
      {!chooser && status === 'ready' && (
        <button type="button" onClick={() => void open(true)} className={PILL_DARK}>
          More ways
        </button>
      )}

      {busy && (
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-14 w-auto" />
          <p className={`${T} text-[#4A4E57]`}>
            {status === 'opening' ? 'Looking at what MYRA has for it…'
              : slow ? 'MYRA is still working on it — the mark in the corner will say when it is ready, wherever you are.'
              : looks.length ? 'MYRA is checking the rest before you see them' : 'MYRA is checking them before you see them'}
          </p>
        </div>
      )}
      {error && !busy && <p className={`${T} text-[#4A4E57]`}>{error}</p>}
      {!busy && !error && status === 'none' && !studio.length && (
        <p className={`${T} text-[#4A4E57]`}>{wayMode === 'wardrobe' ? 'Nothing in your wardrobe goes with it yet.' : 'Nothing in your size goes with it yet.'}</p>
      )}

      {/* FROM THE STUDIO — the outfits Chloe's studio has already made with this
          piece. Not composed, not judged again: what the feed shows, here under
          the piece she tapped (Chloe, 2026-11-03). */}
      {studio.length > 0 && (
        <div className="space-y-4">
          <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>FROM THE STUDIO · {studio.length}</p>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            {studio.map((l) => <ComposedLookCard key={l.outfit_id} look={l} heroId={itemId} testMemberId={testMemberId} />)}
          </div>
          {(looks.length > 0 || busy) && (
            <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65] pt-2`}>MYRA&rsquo;S WAYS FOR YOU{wayMode === 'wardrobe' ? ' · WITH YOUR WARDROBE' : ''}</p>
          )}
        </div>
      )}
      {!chooser && status === 'idle' && (
        <button type="button" onClick={() => void open(false)} className={PILL_DARK}>
          {looks.length ? 'See more ways' : startLabel ?? 'See it styled'}
        </button>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {Array.from({ length: slots }).map((_, i) => {
          const l = looks[i]
          if (l) {
            const savedLook = liked[l.styled_way_id] ?? (l.reaction === 'like' ? l.saved_look_id ?? null : null)
            return (
              <div key={l.styled_way_id} className="space-y-2">
                {l.occasion_label && <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>{l.occasion_label.toUpperCase()}</p>}
                {l.image_url && (
                  // MYRA's picture of the outfit, made ahead; the pieces below stay for swapping.
                  <div className="relative aspect-[3/4] bg-[#E4E2DD] rounded-[14px] overflow-hidden">
                    <FallbackImage src={l.image_url} thumbWidth={900} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  </div>
                )}
                <BuiltOutfit
                  items={l.items}
                  heroId={itemId}
                  why={l.why}
                  testMemberId={testMemberId}
                  onChange={(items) => setEdited((e) => ({ ...e, [l.styled_way_id]: items }))}
                  onPiece={(it) => it.item_id && setWaysFor({ item_id: it.item_id, product_name: it.product_name, brand: it.brand ?? null, image_url: it.image_url ?? null, url: it.url ?? null, price_gbp: it.price_gbp ?? null })}
                />
                {!savedLook && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      disabled={reacting === l.styled_way_id}
                      onClick={() => void react(l, 'like')}
                      className={`${PILL_LIGHT} disabled:opacity-40`}
                      aria-label="Like this outfit — it is saved to your looks"
                    >
                      {reacting === l.styled_way_id ? 'Saving…' : '♥ Love it'}
                    </button>
                    <button
                      type="button"
                      disabled={reacting === l.styled_way_id}
                      onClick={() => void react(l, 'dislike')}
                      className={`${T_SMALL} px-5 py-2.5 rounded-full text-[#6E6B65] underline underline-offset-4 disabled:opacity-40`}
                    >
                      Not for me
                    </button>
                    <ShareWithFriend variant="quiet" testMemberId={testMemberId} attachment={lookAttachment(edited[l.styled_way_id] ?? l.items, l.image_url, l.occasion_label)} />
                  </div>
                )}
                {savedLook && (
                  <ShareWithFriend variant="quiet" testMemberId={testMemberId} attachment={lookAttachment(edited[l.styled_way_id] ?? l.items, l.image_url, l.occasion_label)} />
                )}
                <SaveOutfit
                  key={savedLook ? `saved-${savedLook}` : 'unsaved'}
                  items={edited[l.styled_way_id] ?? l.items}
                  why={l.why}
                  occasion={l.occasion_id ?? null}
                  testMemberId={testMemberId}
                  styledWayId={l.styled_way_id}
                  pictureUrl={l.image_url}
                  initialLookId={savedLook}
                />
                {test && <p className="text-[15px] text-[#7C838B]">{l.verdict === 'works' ? 'works' : 'borderline'} · kept {new Date(l.judged_at).toLocaleDateString('en-GB')}</p>}
              </div>
            )
          }
          if (!busy) return null
          return (
            <div key={`slot-${i}`} className="rounded-[16px] overflow-hidden bg-white/70">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-[#EDEBE7]">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="aspect-[3/4] bg-gradient-to-r from-[#E9E9E7] via-[#F4F4F2] to-[#E9E9E7] animate-pulse" />
                ))}
              </div>
              <div className="h-14" />
            </div>
          )
        })}
      </div>

      {/* The picture, full screen: a tap anywhere closes it. */}
      {zoom && shownPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={name}
          data-lenis-prevent
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-[160] bg-[#141414]/85 flex items-center justify-center p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shownPhoto} alt={p.product_name ?? ''} className="max-w-full max-h-[90vh] object-contain rounded-[12px] bg-white" />
          <button type="button" aria-label="Close" className="absolute top-[calc(14px+env(safe-area-inset-top,0px))] right-4 w-11 h-11 rounded-full bg-white/90 text-[#2B2B2B] text-[22px] leading-none">×</button>
        </div>
      )}

      {waysFor && (
        <WaysToWear itemId={waysFor.item_id} piece={waysFor} testMemberId={testMemberId} autoStart={false} startLabel="Build outfits with it" onClose={() => setWaysFor(null)} />
      )}
    </div>
  )

  if (inline) return <section className="w-full">{body}</section>
  return (
    // Stops above the phone's tab bar, so every room is still a tap away.
    <div data-lenis-prevent className="fixed inset-x-0 top-0 bottom-[calc(68px+env(safe-area-inset-bottom))] sm:bottom-0 z-[130] overflow-y-auto myra-pearl" role="dialog" aria-label="In the mirror">
      {body}
    </div>
  )
}

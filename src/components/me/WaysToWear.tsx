'use client'

// WAYS TO WEAR IT — one piece, pinned, and the outfits MYRA built around it.
//
// The same sheet on every surface a piece can be tapped from: her piece page,
// a piece she kept while shopping, a hotspot on one of her looks, Browse,
// FOR YOU. What MYRA already keeps for the piece shows at once; when there is
// nothing yet, three slots wait and each fills the moment that look has been
// through MYRA's eye. Nothing unchecked is ever drawn. Closing the sheet does
// not stop the work: the piece she left shows a small mark when it lands.
//
// Every outfit is drawn by BuiltOutfit, so each piece can be swapped (search,
// brand, type, colour) and undone, as everywhere else she builds outfits.

import { useEffect, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import BuiltOutfit from '@/app/me/dressing-room/BuiltOutfit'
import SaveOutfit from '@/components/me/SaveOutfit'
import ShareWithFriend from '@/components/me/ShareWithFriend'
import type { LookItem } from '@/lib/pilot-stylist'
import { openWaysToWear, pollWaysToWear, reactToWay, type WaysPiece, type WaysStatus } from '@/app/me/ways/actions'
import { WAYS, type StyledWayLook, type WayMode } from '@/lib/styled-ways-core'
import { watchWays, clearWaysReady } from './ways-watch'
import { journeySignal } from '@/lib/journey'

const T = 'text-[19px] xl:text-[22px] 2xl:text-[26px]'
const T_SMALL = 'text-[17px] xl:text-[20px] 2xl:text-[23px]'
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

export default function WaysToWear({
  itemId, piece, mode = 'blend', testMemberId, onClose, inline = false, heading, autoStart = true, onStatus,
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
  /** Where the sheet has got to, and how many ways have landed — for a page that shows its own progress mark. */
  onStatus?: (status: WaysStatus | 'opening', landed: number) => void
}) {
  const [looks, setLooks] = useState<StyledWayLook[]>([])
  const [status, setStatus] = useState<WaysStatus | 'opening'>('opening')
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<WaysPiece | null>(null)
  const [test, setTest] = useState(false)
  // What each way looks like after her swaps — what SAVE keeps.
  const [edited, setEdited] = useState<Record<string, LookItem[]>>({})
  // Her verdicts this sitting: a like is saved at once (the look id), a dislike is gone.
  const [liked, setLiked] = useState<Record<string, string>>({})
  const [reacting, setReacting] = useState<string | null>(null)

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
    try { next = await pollWaysToWear(itemId, mode, testMemberId) } catch { /* try again */ }
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

  async function open(more: boolean, passive = false) {
    setError(null)
    setStatus(more ? 'working' : 'opening')
    startedAt.current = Date.now()
    setSlow(false)
    const v = await openWaysToWear(itemId, { mode, more, passive }, testMemberId)
    if (!live.current) return
    if (v.piece) setShown(v.piece)
    setTest(!!v.test)
    setLooks(v.looks)
    if (v.error && v.status !== 'working') setError(v.error)
    setStatus(v.status)
    if (v.status === 'working') { working.current = true; setTimeout(poll, POLL_MS) }
  }

  useEffect(() => {
    live.current = true
    clearWaysReady(itemId, mode)
    void open(false, !autoStart)
    return () => {
      live.current = false
      if (working.current) watchWays(itemId, mode, testMemberId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, mode, testMemberId])
  useEffect(() => { onStatus?.(status, looks.length) }, [status, looks.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // Asked for after a passive open: start now.
  useEffect(() => {
    if (autoStart && status === 'idle') void open(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  const p = { ...(piece ?? {}), ...(shown ?? {}) } as Partial<WaysPiece>
  const busy = status === 'opening' || status === 'working'
  const slots = Math.max(WAYS, looks.length)
  const name = (p.brand ? `${p.brand} ` : '') + (p.product_name ?? '')

  const body = (
    <div className={`w-full ${inline ? '' : 'px-6 sm:px-10 pt-[calc(40px+env(safe-area-inset-top,0px))] pb-10 max-w-[1700px] mx-auto'} space-y-8`}>
      <div className="flex items-center gap-5 flex-wrap">
        <div className="relative w-[72px] sm:w-[96px] flex-none aspect-[3/4] bg-white rounded-[12px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)]">
          {p.image_url && <FallbackImage src={p.image_url} thumbWidth={300} alt={p.product_name ?? ''} className="absolute inset-0 w-full h-full object-contain" />}
        </div>
        <div className="flex-1 min-w-[200px]">
          <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>{heading ?? 'WAYS TO WEAR IT'}</p>
          <p className={`${T} text-[#2B2B2B] leading-tight line-clamp-2`}>{name}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {status === 'ready' && (
            <button type="button" onClick={() => void open(true)} className={`${T_SMALL} px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white`}>
              More ways
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className={`${T_SMALL} text-[#6E6B65] underline underline-offset-4`}>
              {inline ? 'Close' : '← Back'}
            </button>
          )}
        </div>
      </div>

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
      {!busy && !error && status === 'none' && <p className={`${T} text-[#4A4E57]`}>Nothing in your size goes with it yet.</p>}
      {status === 'idle' && (
        <button type="button" onClick={() => void open(false)} className={`${T_SMALL} px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white`}>
          {looks.length ? 'See more ways' : 'See it styled'}
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
                <BuiltOutfit items={l.items} heroId={itemId} why={l.why} testMemberId={testMemberId} onChange={(items) => setEdited((e) => ({ ...e, [l.styled_way_id]: items }))} />
                {!savedLook && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      disabled={reacting === l.styled_way_id}
                      onClick={() => void react(l, 'like')}
                      className={`${T_SMALL} px-5 py-2.5 rounded-full border border-[#2B2B2B] text-[#2B2B2B] disabled:opacity-40`}
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
    </div>
  )

  if (inline) return <section className="w-full">{body}</section>
  return (
    <div data-lenis-prevent className="fixed inset-0 z-[130] overflow-y-auto myra-pearl" role="dialog" aria-label="Ways to wear it">
      {body}
    </div>
  )
}

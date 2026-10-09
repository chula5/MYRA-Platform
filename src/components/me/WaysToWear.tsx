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
import type { LookItem } from '@/lib/pilot-stylist'
import { openWaysToWear, pollWaysToWear, type WaysPiece, type WaysStatus } from '@/app/me/ways/actions'
import { WAYS, type StyledWayLook, type WayMode } from '@/lib/styled-ways-core'
import { watchWays, clearWaysReady } from './ways-watch'

const T = 'text-[19px] xl:text-[22px] 2xl:text-[26px]'
const T_SMALL = 'text-[17px] xl:text-[20px] 2xl:text-[23px]'
const POLL_MS = 1_500
const MAX_POLLS = 90

export default function WaysToWear({
  itemId, piece, mode = 'blend', testMemberId, onClose, inline = false, heading, autoStart = true,
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
}) {
  const [looks, setLooks] = useState<StyledWayLook[]>([])
  const [status, setStatus] = useState<WaysStatus | 'opening'>('opening')
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<WaysPiece | null>(null)
  const [test, setTest] = useState(false)
  // What each way looks like after her swaps — what SAVE keeps.
  const [edited, setEdited] = useState<Record<string, LookItem[]>>({})
  const polls = useRef(0)
  const live = useRef(true)
  const working = useRef(false)

  async function poll() {
    if (!live.current) return
    polls.current++
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
    if (polls.current < MAX_POLLS) setTimeout(poll, POLL_MS)
    else { working.current = false; setStatus(looks.length ? 'ready' : 'failed'); setError('MYRA is taking longer than usual. Come back in a moment.') }
  }

  async function open(more: boolean, passive = false) {
    setError(null)
    setStatus(more ? 'working' : 'opening')
    polls.current = 0
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
    <div className={`w-full ${inline ? '' : 'px-6 sm:px-10 py-10 max-w-[1700px] mx-auto'} space-y-8`}>
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
            {status === 'opening' ? 'Looking at what MYRA has for it…' : looks.length ? 'MYRA is checking the rest before you see them' : 'MYRA is checking them before you see them'}
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
            return (
              <div key={l.styled_way_id} className="space-y-2">
                {l.occasion_label && <p className={`${T_SMALL} tracking-[0.12em] text-[#6E6B65]`}>{l.occasion_label.toUpperCase()}</p>}
                <BuiltOutfit items={l.items} heroId={itemId} why={l.why} testMemberId={testMemberId} onChange={(items) => setEdited((e) => ({ ...e, [l.styled_way_id]: items }))} />
                <SaveOutfit items={edited[l.styled_way_id] ?? l.items} why={l.why} occasion={l.occasion_id ?? null} testMemberId={testMemberId} />
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

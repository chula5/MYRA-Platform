'use client'

// WHAT MYRA FOUND IN HER PHOTOS — in the Dressing Room, where her pieces
// live (Chloe, 2026-10-18: the found pieces belong on the rail, not on the
// upload page). While her photos are still being worked through this keeps
// the queue moving and shows how many are left; each piece found is a card
// she answers — YES, ADD TO MY WARDROBE, or not this one — and a yes puts it
// straight on the rail behind.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loadMyFoundPieces, nudgeMyQueue, type MyFoundPieces } from '@/app/me/wardrobe/actions'
import ReviewCard from '@/app/me/wardrobe/ReviewCard'

const CARD = 'bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] rounded-[18px]'

export default function FoundPieces() {
  const router = useRouter()
  const [view, setView] = useState<MyFoundPieces | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    const v = await loadMyFoundPieces().catch(() => null)
    if (v) setView(v)
  }
  useEffect(() => { void refresh() }, [])

  // Keep the queue moving while anything is still being worked through.
  const nudging = useRef(false)
  useEffect(() => {
    if (!view?.processing || !view.ready) return
    let alive = true
    const tick = async () => {
      if (nudging.current || !alive) return
      nudging.current = true
      try { await nudgeMyQueue() } finally { nudging.current = false }
      if (alive) await refresh()
    }
    void tick()
    const id = setInterval(tick, 12_000)
    return () => { alive = false; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.processing, view?.ready, view?.queued])

  async function act(key: string, fn: () => Promise<{ error?: string } | any>) {
    setBusy(key); setError(null)
    const r = await fn()
    if (r?.error) setError(r.error)
    setBusy(null)
    await refresh()
    // A yes put a piece on the rail: the room is server-drawn, so redraw it.
    if (key.startsWith('ap-')) router.refresh()
  }

  if (!view) return null
  const review = view.queue.filter((q) => q.status === 'review' || q.status === 'failed')
  const working = view.queue.filter((q) => !['review', 'failed'].includes(q.status)).length
  const finding = working > 0 || view.processing
  if (!review.length && !finding) return null

  return (
    <section className={`${CARD} px-5 sm:px-8 py-7 space-y-4`} data-tour="found-pieces">
      <h2 className="text-[26px] xl:text-[29px] 2xl:text-[33px] tracking-[0.06em] text-[#2B2B2B]">FOUND IN YOUR PHOTOS</h2>
      {finding && (
        <p className="text-[18px] xl:text-[21px] 2xl:text-[25px] text-[#7C838B]">
          Finding your pieces… {working > 0 ? `${working} to go.` : `${view.queued} photo${view.queued === 1 ? '' : 's'} to go.`}
        </p>
      )}
      {error && <p className="text-[18px] xl:text-[21px] text-[#B83A3A]">{error}</p>}
      <div className="space-y-3">
        {review.map((x) => <ReviewCard key={x.extraction_id} x={x} busy={busy} act={act} />)}
      </div>
    </section>
  )
}

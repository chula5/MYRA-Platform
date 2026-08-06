'use client'

// Mobile swipe review queue — one outfit per full-screen card, displayed as a
// composed item group (unapproved outfits have no Higgsfield image by rule).
// Swipe right / ✓ approves (render fires AFTER approval, then auto-publish);
// swipe left / ✕ rejects (no render ever). Tapping an item chip opens the
// bottom swap sheet with exactly 3 pre-ranked replacements.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import FallbackImage from '@/components/FallbackImage'
import type { ReviewCard } from '@/lib/studio/review-queue'
import {
  approveOutfitAction,
  rejectOutfitAction,
  getSwapSheetAction,
  applySwapAction,
  needsDesktopAction,
  runSentinelNowAction,
  type SwapSheetCandidate,
} from './actions'

interface DeepLink {
  outfitId: string
  deadItemId: string | null
  pickItemId: string | null
}

export default function ReviewClient({
  initialQueue,
  renderingCount,
  deepLink,
}: {
  initialQueue: ReviewCard[]
  renderingCount: number
  deepLink: DeepLink | null
}) {
  const [queue, setQueue] = useState<ReviewCard[]>(initialQueue)
  const [idx, setIdx] = useState(() => {
    if (!deepLink) return 0
    const i = initialQueue.findIndex((c) => c.outfitId === deepLink.outfitId)
    return i >= 0 ? i : 0
  })
  const [dragX, setDragX] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const [busy, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  // Swap sheet state
  const [sheet, setSheet] = useState<{
    outfitItemId: string
    itemLabel: string
    loading: boolean
    candidates: SwapSheetCandidate[]
    highlight: string | null
  } | null>(null)

  const [sentinelStatus, setSentinelStatus] = useState<string | null>(null)

  const card = queue[idx] ?? null
  const total = queue.length

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  const removeCurrent = () => {
    setQueue((q) => q.filter((_, i) => i !== idx))
    setDragX(0)
    setSheet(null)
    setIdx((i) => Math.min(i, Math.max(0, total - 2)))
  }

  // ── Decisions ──────────────────────────────────────────────
  function approve() {
    if (!card || busy) return
    if (card.kind === 'restock') {
      // A restock card is already approved — it needs a replacement pick, not
      // a re-approval. (Approve would also imply a render on a broken set.)
      flash('PICK A REPLACEMENT FOR THE FLAGGED ITEM FIRST')
      setDragX(0)
      return
    }
    const id = card.outfitId
    removeCurrent()
    startTransition(async () => {
      const res = await approveOutfitAction(id)
      flash(res.error ? `APPROVE FAILED — ${res.error}` : 'APPROVED — RENDERING & PUBLISHING')
    })
  }

  function reject() {
    if (!card || busy) return
    const id = card.outfitId
    removeCurrent()
    startTransition(async () => {
      const res = await rejectOutfitAction(id)
      flash(res.error ? `REJECT FAILED — ${res.error}` : 'REJECTED')
    })
  }

  function noneOfThese() {
    if (!card || busy) return
    const id = card.outfitId
    removeCurrent()
    startTransition(async () => {
      const res = await needsDesktopAction(id)
      flash(res.error ?? 'SENT TO DESKTOP STUDIO')
    })
  }

  // ── Swap sheet ─────────────────────────────────────────────
  function openSheet(outfitItemId: string, itemLabel: string, highlight: string | null = null) {
    if (!card) return
    setSheet({ outfitItemId, itemLabel, loading: true, candidates: [], highlight })
    startTransition(async () => {
      const res = await getSwapSheetAction(card.outfitId, outfitItemId)
      setSheet((s) =>
        s && s.outfitItemId === outfitItemId
          ? { ...s, loading: false, candidates: res.candidates ?? [] }
          : s,
      )
      if (res.error) flash(res.error)
    })
  }

  function pickReplacement(candidate: SwapSheetCandidate) {
    if (!card || !sheet) return
    const { outfitId } = card
    const { outfitItemId } = sheet
    setSheet(null)
    startTransition(async () => {
      const res = await applySwapAction(outfitId, outfitItemId, candidate.itemId)
      if (res.error) {
        flash(`SWAP FAILED — ${res.error}`)
        return
      }
      flash(`SWAPPED IN ${candidate.name.toUpperCase().slice(0, 24)}`)
      // Reflect the new item + rebuilt composed group on the card in place.
      setQueue((q) =>
        q.map((c) =>
          c.outfitId === outfitId
            ? {
                ...c,
                composedGroupUrl: res.composedGroupUrl ?? c.composedGroupUrl,
                items: c.items.map((it) =>
                  it.outfitItemId === outfitItemId
                    ? { ...it, itemId: candidate.itemId, name: candidate.name, brand: candidate.brand, price: candidate.price, image: candidate.image, dead: false }
                    : it,
                ),
                kind: c.kind === 'restock' ? 'review' : c.kind, // dead item resolved
                deadItemId: null,
              }
            : c,
        ),
      )
    })
  }

  // Deep link from a stock email: open the swap sheet on the dead item.
  const deepLinkApplied = useRef(false)
  useEffect(() => {
    if (deepLinkApplied.current || !deepLink?.deadItemId || !card) return
    if (card.outfitId !== deepLink.outfitId) return
    const target = card.items.find((it) => it.itemId === deepLink.deadItemId)
    if (target) {
      deepLinkApplied.current = true
      openSheet(target.outfitItemId, target.name, deepLink.pickItemId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.outfitId])

  // ── Gestures ───────────────────────────────────────────────
  const SWIPE_THRESHOLD = 90
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }
  function onTouchMove(e: React.TouchEvent) {
    if (touchStartX.current !== null) setDragX(e.touches[0].clientX - touchStartX.current)
  }
  function onTouchEnd() {
    if (touchStartX.current === null) return
    const dx = dragX
    touchStartX.current = null
    if (dx > SWIPE_THRESHOLD) approve()
    else if (dx < -SWIPE_THRESHOLD) reject()
    else setDragX(0)
  }

  function runSentinel() {
    setSentinelStatus('CHECKING STOCK…')
    startTransition(async () => {
      const res = await runSentinelNowAction()
      setSentinelStatus(res.summary ?? res.error ?? null)
    })
  }

  const laneBadge = useMemo(() => {
    if (!card) return null
    if (card.kind === 'restock') {
      return <span className="text-[9px] tracking-[0.09em] px-2.5 py-1 rounded-full bg-[#B83A3A] text-white">RESTOCK — PICK A REPLACEMENT</span>
    }
    return card.lane === 'fast' ? (
      <span className="text-[9px] tracking-[0.09em] px-2.5 py-1 rounded-full bg-[#0A0A0A] text-white">
        FAST LANE · {(card.confidence * 100).toFixed(0)}%
      </span>
    ) : (
      <span className="text-[9px] tracking-[0.09em] px-2.5 py-1 rounded-full border border-[#C9C7C2] text-[#6B6B6B]">
        STANDARD · {(card.confidence * 100).toFixed(0)}%
      </span>
    )
  }, [card])

  return (
    <div className="min-h-[100dvh] bg-[#F2F2F2] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 h-12 bg-white border-b border-[#E2E0DB] shrink-0">
        <a href="/admin" className="text-[10px] tracking-[0.1em] text-[#6B6B6B]">← STUDIO</a>
        <p className="text-[12px] tracking-[0.135em] text-[#4A4E57]">REVIEW</p>
        <button
          onClick={runSentinel}
          disabled={busy}
          className="text-[9px] tracking-[0.08em] text-[#6B6B6B] hover:text-[#4A4E57] disabled:opacity-40"
        >
          ⟳ STOCK
        </button>
      </header>

      {sentinelStatus && (
        <p className="text-center text-[9px] tracking-[0.07em] text-[#6B6B6B] bg-[#EDEDEB] py-1.5">{sentinelStatus}</p>
      )}

      {!card ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <p className="text-[16px] tracking-[0.09em] text-[#4A4E57] mb-2">QUEUE CLEAR</p>
          <p className="text-[11px] tracking-[0.05em] text-[#A8A8A4]">
            {renderingCount > 0 ? `${renderingCount} render${renderingCount === 1 ? '' : 's'} in flight — outfits publish as they land.` : 'Nothing waiting for review.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col max-w-[520px] w-full mx-auto px-4 pt-3 pb-5 min-h-0">
          {/* Position + badges */}
          <div className="flex items-center justify-between mb-2 shrink-0">
            <p className="text-[10px] tracking-[0.09em] text-[#6B6B6B]">{idx + 1} OF {total}</p>
            {laneBadge}
          </div>

          {/* Card */}
          <div
            className="relative flex-1 min-h-0 bg-white rounded-[16px] border border-[#E2E0DB] overflow-hidden select-none"
            style={{
              transform: `translateX(${dragX}px) rotate(${dragX * 0.03}deg)`,
              transition: touchStartX.current === null ? 'transform 0.25s ease' : 'none',
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Composed item group */}
            <div className="absolute inset-0">
              {card.composedGroupUrl ? (
                <FallbackImage
                  src={card.composedGroupUrl}
                  thumbWidth={1000}
                  alt={card.label}
                  className="w-full h-full object-contain pointer-events-none"
                />
              ) : (
                // Group image still building — consistent fallback grid, same
                // reading order.
                <div className="w-full h-full grid grid-cols-2 gap-1 p-3 bg-[#F7F7F5]">
                  {card.items.slice(0, 6).map((it) => (
                    <FallbackImage
                      key={it.outfitItemId}
                      src={it.image}
                      thumbWidth={400}
                      alt=""
                      className={`w-full h-full object-contain bg-white rounded ${it.dead ? 'opacity-30 grayscale' : ''}`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Swipe hints */}
            {dragX > 40 && (
              <div className="absolute top-6 left-6 border-2 border-[#3A6B3A] text-[#3A6B3A] px-3 py-1 rounded text-[12px] tracking-[0.08em] rotate-[-10deg] bg-white/85 z-10">APPROVE</div>
            )}
            {dragX < -40 && (
              <div className="absolute top-6 right-6 border-2 border-[#B83A3A] text-[#B83A3A] px-3 py-1 rounded text-[12px] tracking-[0.08em] rotate-[10deg] bg-white/85 z-10">REJECT</div>
            )}

            {/* Label + occasions */}
            <div className="absolute inset-x-0 top-0 px-4 pt-3 pb-8 bg-gradient-to-b from-white/95 via-white/70 to-transparent">
              <p className="text-[13px] tracking-[0.08em] text-[#0A0A0A] uppercase">{card.label}</p>
              {card.occasionTags.length > 0 && (
                <p className="text-[9px] tracking-[0.07em] text-[#6B6B6B] mt-0.5 uppercase">
                  {card.occasionTags.slice(0, 4).join(' · ')}
                </p>
              )}
            </div>

            {/* Item chips — tap to swap */}
            <div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-10 bg-gradient-to-t from-white/95 via-white/75 to-transparent">
              <div className="flex flex-wrap gap-1.5">
                {card.items.map((it) => (
                  <button
                    key={it.outfitItemId}
                    onClick={() => openSheet(it.outfitItemId, it.name)}
                    className={`text-left text-[9px] tracking-[0.04em] px-2.5 py-1.5 rounded-full border transition-colors max-w-full truncate ${
                      it.dead
                        ? 'border-[#B83A3A] text-[#B83A3A] bg-white'
                        : 'border-[#D8D6D1] text-[#4A4E57] bg-white/90 hover:border-[#0A0A0A]'
                    }`}
                  >
                    {it.dead ? '⚠ ' : ''}
                    {(it.brand ?? '').toUpperCase()}{it.brand ? ' — ' : ''}{it.name}{it.price ? ` — ${it.price}` : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Decision buttons */}
          <div className="flex items-center justify-center gap-6 pt-4 shrink-0">
            <button
              onClick={reject}
              disabled={busy}
              aria-label="Reject"
              className="w-16 h-16 rounded-full border border-[#E2E0DB] bg-white text-[#B83A3A] text-[22px] flex items-center justify-center hover:border-[#B83A3A] transition-colors disabled:opacity-40"
            >
              ✕
            </button>
            {card.kind === 'restock' ? (
              <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] max-w-[140px] text-center">
                TAP THE FLAGGED ITEM TO PICK A REPLACEMENT
              </p>
            ) : (
              <button
                onClick={noneOfThese}
                disabled={busy}
                className="text-[9px] tracking-[0.07em] text-[#A8A8A4] underline underline-offset-4 hover:text-[#4A4E57] disabled:opacity-40"
              >
                NEEDS DESKTOP
              </button>
            )}
            <button
              onClick={approve}
              disabled={busy || card.kind === 'restock'}
              aria-label="Approve"
              className="w-16 h-16 rounded-full border border-[#E2E0DB] bg-white text-[#3A6B3A] text-[22px] flex items-center justify-center hover:border-[#3A6B3A] transition-colors disabled:opacity-40"
            >
              ✓
            </button>
          </div>
        </div>
      )}

      {/* ── Swap sheet ─────────────────────────────────────────── */}
      {sheet && (
        <div className="fixed inset-0 z-50" onClick={() => setSheet(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-0 bg-white rounded-t-[18px] px-5 pt-4 pb-8 max-h-[70dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#E2E0DB] rounded-full mx-auto mb-4" />
            <p className="text-[10px] tracking-[0.1em] text-[#6B6B6B] mb-1">SWAP OUT</p>
            <p className="text-[13px] tracking-[0.05em] text-[#0A0A0A] uppercase mb-4">{sheet.itemLabel}</p>

            {sheet.loading ? (
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="aspect-[3/4] bg-[#F2F2F0] rounded-[10px] animate-pulse" />
                ))}
              </div>
            ) : sheet.candidates.length === 0 ? (
              <p className="text-[11px] tracking-[0.05em] text-[#A8A8A4] py-6 text-center">
                NO ELIGIBLE REPLACEMENTS IN THE LIBRARY
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {sheet.candidates.map((c) => (
                  <button
                    key={c.itemId}
                    onClick={() => pickReplacement(c)}
                    disabled={busy}
                    className={`text-left group disabled:opacity-50 ${sheet.highlight === c.itemId ? 'ring-2 ring-[#0A0A0A] rounded-[10px]' : ''}`}
                  >
                    <div className="aspect-[3/4] bg-[#F7F7F5] rounded-[10px] overflow-hidden mb-1.5">
                      <FallbackImage
                        src={c.image}
                        thumbWidth={400}
                        alt={c.name}
                        className="w-full h-full object-cover group-hover:opacity-90"
                      />
                    </div>
                    <p className="text-[8px] tracking-[0.06em] text-[#A8A8A4] uppercase truncate">{c.brand ?? ''}</p>
                    <p className="text-[9px] tracking-[0.03em] text-[#4A4E57] leading-tight line-clamp-2">{c.name}</p>
                    <p className="text-[9px] text-[#6B6B6B] mt-0.5">
                      {c.price ?? ''} · {(c.similarity * 100).toFixed(0)}%
                    </p>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => {
                const id = card?.outfitId
                setSheet(null)
                if (id && card?.kind !== 'restock') {
                  noneOfThese()
                }
              }}
              disabled={busy}
              className="mt-5 w-full text-center text-[10px] tracking-[0.08em] text-[#A8A8A4] underline underline-offset-4 hover:text-[#4A4E57] disabled:opacity-40"
            >
              NONE OF THESE — SEND TO DESKTOP
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 inset-x-0 flex justify-center z-[60] pointer-events-none">
          <p className="bg-[#0A0A0A] text-white text-[10px] tracking-[0.08em] px-5 py-2.5 rounded-full">{toast}</p>
        </div>
      )}
    </div>
  )
}

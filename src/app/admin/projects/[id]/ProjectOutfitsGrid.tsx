'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/admin/StatusBadge'
import TagChips from '@/components/admin/TagChips'
import { thumbUrl } from '@/lib/image-utils'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'

// Status changes go through a route handler (not a server action) so they aren't
// queued behind a long-running Higgsfield shoot — server actions run one-at-a-time.
async function postStatus(
  projectId: string,
  outfitIds: string[],
  status: 'live' | 'draft' | 'archived',
): Promise<{ error?: string; count?: number }> {
  try {
    const r = await fetch('/api/admin/set-outfit-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, outfitIds, status }),
    })
    if (!r.ok) return { error: `Failed (${r.status})` }
    return await r.json()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Request failed' }
  }
}

type OutfitLite = {
  outfit_id: string
  image_url: string | null
  aesthetic_label: string
  status: string
  celebrity_name?: string | null
  occasion_tags?: string[] | null
}

export default function ProjectOutfitsGrid({
  projectId,
  outfits,
  popularTags = [],
  coTags = {},
}: {
  projectId: string
  outfits: OutfitLite[]
  popularTags?: string[]
  coTags?: Record<string, string[]>
}) {
  const router = useRouter()
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per-card status while a single toggle is in flight (optimistic override).
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({})
  const [toggling, setToggling] = useState<string | null>(null)
  // Refined Higgsfield shoot state (long-running) — which outfit is generating,
  // the new image once done, and any error.
  // Multiple shoots can run at once — each card tracks its own state.
  const [refining, setRefining] = useState<Set<string>>(new Set())
  const [imageOverride, setImageOverride] = useState<Record<string, string>>({})
  const [refineError, setRefineError] = useState<Record<string, string>>({})

  async function refine(outfitId: string) {
    if (refining.has(outfitId)) return
    setRefining((prev) => new Set(prev).add(outfitId))
    setRefineError((prev) => { const next = { ...prev }; delete next[outfitId]; return next })
    try {
      const res = await generateHiggsfieldShootForOutfit(outfitId, 'E5')
      if (res.error) {
        setRefineError((prev) => ({ ...prev, [outfitId]: res.error! }))
      } else if (res.imageUrl) {
        setImageOverride((prev) => ({ ...prev, [outfitId]: res.imageUrl! }))
        router.refresh()
      }
    } catch (err) {
      setRefineError((prev) => ({ ...prev, [outfitId]: err instanceof Error ? err.message : 'Refine failed' }))
    } finally {
      setRefining((prev) => { const next = new Set(prev); next.delete(outfitId); return next })
    }
  }

  async function toggleStatus(outfitId: string, current: string) {
    if (toggling) return
    const next = current === 'live' ? 'draft' : 'live'
    setToggling(outfitId)
    setStatusOverride((prev) => ({ ...prev, [outfitId]: next }))
    const res = await postStatus(projectId, [outfitId], next as 'live' | 'draft')
    setToggling(null)
    if (res.error) {
      // Roll back the optimistic change.
      setStatusOverride((prev) => ({ ...prev, [outfitId]: current }))
      setError(res.error)
      return
    }
    router.refresh()
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
    setError(null)
  }

  const liveable = outfits.filter((o) => o.status !== 'live')
  const allLiveableSelected = liveable.length > 0 && liveable.every((o) => selected.has(o.outfit_id))

  function selectAllLiveable() {
    setSelected(new Set(liveable.map((o) => o.outfit_id)))
  }

  async function goLive() {
    if (selected.size === 0 || busy) return
    setBusy(true)
    setError(null)
    const res = await postStatus(projectId, Array.from(selected), 'live')
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    exitSelect()
    router.refresh()
  }

  return (
    <div>
      {/* Shared tag-autocomplete vocabulary for the inline tag editors */}
      <datalist id="myra-tag-vocab">
        {popularTags.map((t) => <option key={t} value={t} />)}
      </datalist>

      {/* Selection controls */}
      <div className="flex items-center justify-between mb-4 min-h-[34px]">
        <p className="text-[10px] tracking-[0.09em] text-[#6B6B6B]">
          {selectMode
            ? selected.size > 0
              ? `${selected.size} SELECTED`
              : 'SELECT OUTFITS TO SEND LIVE'
            : `${outfits.length} OUTFIT${outfits.length !== 1 ? 'S' : ''}`}
        </p>

        {!selectMode ? (
          <button
            type="button"
            onClick={() => setSelectMode(true)}
            disabled={outfits.length === 0}
            className="border border-[#0A0A0A] text-[#4A4E57] px-5 py-2 text-[10px] tracking-[0.09em] hover:bg-[#0A0A0A] hover:text-white transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            SELECT OUTFITS
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={allLiveableSelected ? () => setSelected(new Set()) : selectAllLiveable}
              className="border border-[#E2E0DB] text-[#6B6B6B] px-4 py-2 text-[10px] tracking-[0.09em] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-300"
            >
              {allLiveableSelected ? 'CLEAR ALL' : 'SELECT ALL'}
            </button>
            <button
              type="button"
              onClick={goLive}
              disabled={selected.size === 0 || busy}
              className="bg-[#0A0A0A] text-white px-6 py-2 text-[10px] tracking-[0.09em] hover:bg-[#333] transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'SENDING LIVE…' : `GO LIVE${selected.size ? ` (${selected.size})` : ''}`}
            </button>
            <button
              type="button"
              onClick={exitSelect}
              className="border border-[#E2E0DB] text-[#6B6B6B] px-4 py-2 text-[10px] tracking-[0.09em] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-300"
            >
              CANCEL
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-3 text-[10px] tracking-[0.068em] text-[#B83A3A]">{error.toUpperCase()}</p>
      )}

      {/* Outfits grid */}
      <div className="grid grid-cols-3 gap-6">
        {outfits.map((outfit) => {
          const isSelected = selected.has(outfit.outfit_id)
          const effectiveStatus = statusOverride[outfit.outfit_id] ?? outfit.status
          const isLive = effectiveStatus === 'live'
          return (
            <div
              key={outfit.outfit_id}
              onClick={selectMode ? () => toggle(outfit.outfit_id) : undefined}
              className={`relative border bg-white rounded-[12px] overflow-hidden group transition-colors duration-300 ${
                selectMode ? 'cursor-pointer' : ''
              } ${
                isSelected
                  ? 'border-[#0A0A0A] ring-2 ring-[#0A0A0A]'
                  : 'border-[#E2E0DB] hover:border-[#C4A882]'
              }`}
            >
              {/* Image */}
              <div className="bg-[#F2F2F0] overflow-hidden relative" style={{ aspectRatio: '3/4' }}>
                {(imageOverride[outfit.outfit_id] ?? outfit.image_url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbUrl(imageOverride[outfit.outfit_id] ?? outfit.image_url!, 600)} alt={outfit.aesthetic_label} loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[9px] tracking-[0.068em] text-[#A8A8A4]">NO IMAGE</span>
                  </div>
                )}

                {/* Refining overlay — Higgsfield shoot in progress */}
                {refining.has(outfit.outfit_id) && (
                  <div className="absolute inset-0 bg-white/75 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2">
                    <div className="w-6 h-6 border-2 border-[#C4A882] border-t-transparent rounded-full animate-spin" />
                    <span className="text-[9px] tracking-[0.12em] text-[#4A4E57]">REFINING…</span>
                    <span className="text-[8px] tracking-[0.06em] text-[#A8A8A4] px-4 text-center">this can take a minute</span>
                  </div>
                )}

                {/* Selection checkbox */}
                {selectMode && (
                  <div
                    className={`absolute top-2 left-2 w-6 h-6 rounded-full border flex items-center justify-center text-[12px] ${
                      isSelected
                        ? 'bg-[#0A0A0A] border-[#0A0A0A] text-white'
                        : 'bg-white/90 border-[#0A0A0A] text-transparent'
                    }`}
                  >
                    ✓
                  </div>
                )}
              </div>

              {/* Card body */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] tracking-[0.068em] text-[#4A4E57] truncate">
                    {(outfit.celebrity_name || outfit.aesthetic_label).toUpperCase()}
                  </p>
                  {selectMode ? (
                    <StatusBadge status={effectiveStatus} />
                  ) : (
                    // Click to flip DRAFT ↔ LIVE instantly. Green = live, grey = draft.
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleStatus(outfit.outfit_id, effectiveStatus) }}
                      disabled={toggling === outfit.outfit_id}
                      title={isLive ? 'Click to move back to draft' : 'Click to send live'}
                      className={`inline-flex items-center gap-1 rounded-full pl-2 pr-2.5 py-1 text-[9px] tracking-[0.09em] border transition-colors duration-200 disabled:opacity-50 ${
                        isLive
                          ? 'bg-[#EAF3EC] border-[#BBD9C2] text-[#3D7A50] hover:bg-[#DCEDE1]'
                          : 'bg-[#FAFAF8] border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57]'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-[#3D7A50]' : 'bg-[#C9C7C2]'}`} />
                      {toggling === outfit.outfit_id ? '…' : isLive ? 'LIVE' : 'DRAFT'}
                    </button>
                  )}
                </div>
                {selectMode ? (
                  <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4]">
                    {isLive ? 'ALREADY LIVE' : isSelected ? 'SELECTED ✓' : 'TAP TO SELECT'}
                  </p>
                ) : (
                  <>
                    {/* Inline tag editor — delete with ×, quick-add, free-add */}
                    <div className="mb-3">
                      <TagChips
                        outfitId={outfit.outfit_id}
                        initialTags={(outfit.occasion_tags ?? []).map((t) => t.toLowerCase())}
                        suggestions={popularTags}
                        coTags={coTags}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/admin/projects/${projectId}/outfits/${outfit.outfit_id}/edit`}
                        className="text-[9px] tracking-[0.09em] text-[#6B6B6B] group-hover:text-[#4A4E57] transition-colors duration-300"
                      >
                        EDIT →
                      </Link>
                      {/* Trigger a Refined Higgsfield shoot; replaces the display image. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); refine(outfit.outfit_id) }}
                        disabled={refining.has(outfit.outfit_id)}
                        title="Generate a refined model shoot and use it as the display image"
                        className="inline-flex items-center gap-1 border border-[#C4A882] text-[#8A7A4E] rounded-full px-2.5 py-1 text-[9px] tracking-[0.09em] hover:bg-[#FBF6EA] transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {refining.has(outfit.outfit_id) ? 'REFINING…' : '✦ REFINE'}
                      </button>
                    </div>
                    {refineError[outfit.outfit_id] && !refining.has(outfit.outfit_id) && (
                      <p className="mt-1.5 text-[8px] tracking-[0.05em] text-[#B83A3A]">{refineError[outfit.outfit_id].toUpperCase()}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}

        {/* Add outfit card — hidden during selection */}
        {!selectMode && (
          <Link
            href={`/admin/projects/${projectId}/outfits/new`}
            className="border border-dashed border-[#E2E0DB] bg-transparent rounded-[12px] flex items-center justify-center min-h-[280px] hover:border-[#0A0A0A] transition-colors duration-400 group"
          >
            <div className="text-center">
              <p className="text-[24px] text-[#E2E0DB] group-hover:text-[#A8A8A4] transition-colors duration-300 mb-2">+</p>
              <p className="text-[10px] tracking-[0.09em] text-[#A8A8A4] group-hover:text-[#4A4E57] transition-colors duration-300">
                ADD OUTFIT
              </p>
            </div>
          </Link>
        )}
      </div>
    </div>
  )
}

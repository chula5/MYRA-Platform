'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/admin/StatusBadge'
import TagChips from '@/components/admin/TagChips'
import { thumbUrl } from '@/lib/image-utils'
import { setOutfitsStatus } from '@/app/admin/projects/actions'

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
    const res = await setOutfitsStatus(projectId, Array.from(selected), 'live')
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
          const isLive = outfit.status === 'live'
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
                {outfit.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbUrl(outfit.image_url, 600)} alt={outfit.aesthetic_label} loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[9px] tracking-[0.068em] text-[#A8A8A4]">NO IMAGE</span>
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
                  <StatusBadge status={outfit.status} />
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
                    <Link
                      href={`/admin/projects/${projectId}/outfits/${outfit.outfit_id}/edit`}
                      className="text-[9px] tracking-[0.09em] text-[#6B6B6B] group-hover:text-[#4A4E57] transition-colors duration-300"
                    >
                      EDIT →
                    </Link>
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

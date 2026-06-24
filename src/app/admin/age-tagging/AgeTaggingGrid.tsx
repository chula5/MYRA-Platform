'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { updateOutfitAgeRanges } from '@/app/admin/projects/actions'
import { AGE_RANGES } from '@/app/onboarding/brand-groups'

export interface TaggingOutfit {
  id: string
  image: string
  label: string
  occasions: string[]
  ageRanges: string[]
}

export default function AgeTaggingGrid({ outfits }: { outfits: TaggingOutfit[] }) {
  // Local copy so toggles reflect instantly.
  const [state, setState] = useState<Record<string, string[]>>(
    () => Object.fromEntries(outfits.map((o) => [o.id, o.ageRanges])),
  )
  const [saving, setSaving] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  const [hideTagged, setHideTagged] = useState(false)

  const taggedCount = useMemo(
    () => Object.values(state).filter((r) => r.length > 0).length,
    [state],
  )

  async function toggle(id: string, range: string) {
    const current = state[id] ?? []
    const next = current.includes(range)
      ? current.filter((r) => r !== range)
      : [...current, range]

    setState((s) => ({ ...s, [id]: next }))
    setSaving((s) => ({ ...s, [id]: 'saving' }))

    const res = await updateOutfitAgeRanges(id, next)
    setSaving((s) => ({ ...s, [id]: res?.error ? 'error' : 'saved' }))
    if (!res?.error) {
      setTimeout(() => setSaving((s) => {
        const { [id]: _, ...rest } = s
        return rest
      }), 1500)
    }
  }

  async function applyAll(id: string, ranges: string[]) {
    setState((s) => ({ ...s, [id]: ranges }))
    setSaving((s) => ({ ...s, [id]: 'saving' }))
    const res = await updateOutfitAgeRanges(id, ranges)
    setSaving((s) => ({ ...s, [id]: res?.error ? 'error' : 'saved' }))
    if (!res?.error) {
      setTimeout(() => setSaving((s) => {
        const { [id]: _, ...rest } = s
        return rest
      }), 1500)
    }
  }

  const visible = hideTagged
    ? outfits.filter((o) => (state[o.id] ?? []).length === 0)
    : outfits

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6 sticky top-0 bg-[#FAFAF8] py-3 z-10 border-b border-[#E2E0DB]">
        <p className="text-[11px] tracking-[0.068em] text-[#6B6B6B]">
          <span className="text-[#4A4E57]">{taggedCount}</span> of {outfits.length} tagged
        </p>
        <button
          onClick={() => setHideTagged((v) => !v)}
          className={`text-[10px] tracking-[0.081em] px-4 py-2 rounded-[3px] border transition-colors ${
            hideTagged
              ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
              : 'bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
          }`}
        >
          {hideTagged ? '✓ SHOWING UNTAGGED ONLY' : 'HIDE TAGGED'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {visible.map((o) => {
          const ranges = state[o.id] ?? []
          const st = saving[o.id]
          return (
            <div key={o.id} className="border border-[#E2E0DB] bg-white rounded-[4px] overflow-hidden">
              <div className="flex gap-3 p-3">
                <div className="relative w-[90px] h-[120px] flex-shrink-0 rounded-[2px] overflow-hidden bg-[#FAFAF8]">
                  {o.image && (
                    <Image src={o.image} alt={o.label} fill className="object-cover" sizes="90px" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] tracking-[0.054em] text-[#4A4E57] truncate">
                      {(o.label || 'UNTITLED').toUpperCase()}
                    </p>
                    <span className="text-[8px] tracking-[0.072em] ml-2 flex-shrink-0">
                      {st === 'saving' && <span className="text-[#A8A8A4]">…</span>}
                      {st === 'saved' && <span className="text-[#3A6B3A]">✓</span>}
                      {st === 'error' && <span className="text-[#B83A3A]">!</span>}
                    </span>
                  </div>
                  <p className="text-[8px] tracking-[0.045em] text-[#A8A8A4] mb-2 truncate">
                    {o.occasions.join(' · ') || '—'}
                  </p>

                  {/* Age range chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {AGE_RANGES.map((r) => {
                      const active = ranges.includes(r)
                      return (
                        <button
                          key={r}
                          onClick={() => toggle(o.id, r)}
                          className={`px-2 py-1 text-[9px] tracking-[0.036em] rounded-[2px] border transition-colors ${
                            active
                              ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                              : 'bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
                          }`}
                        >
                          {r}
                        </button>
                      )
                    })}
                  </div>

                  {/* Quick presets */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      onClick={() => applyAll(o.id, ['25-30', '30-40'])}
                      className="text-[8px] tracking-[0.054em] text-[#6B6B6B] underline underline-offset-2 hover:text-[#4A4E57]"
                    >
                      YOUNGER (–35)
                    </button>
                    <button
                      onClick={() => applyAll(o.id, ['40-50', '50-60', '60-70', '70+'])}
                      className="text-[8px] tracking-[0.054em] text-[#6B6B6B] underline underline-offset-2 hover:text-[#4A4E57]"
                    >
                      40+
                    </button>
                    {ranges.length > 0 && (
                      <button
                        onClick={() => applyAll(o.id, [])}
                        className="text-[8px] tracking-[0.054em] text-[#A8A8A4] underline underline-offset-2 hover:text-[#B83A3A]"
                      >
                        CLEAR (ALL AGES)
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {visible.length === 0 && (
        <p className="text-center text-[11px] tracking-[0.09em] text-[#A8A8A4] py-16">
          ALL OUTFITS TAGGED ✓
        </p>
      )}
    </div>
  )
}

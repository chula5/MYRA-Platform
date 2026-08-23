'use client'

import { useState } from 'react'
import {
  SIZE_CATEGORIES, CATEGORY_LABEL, ladderFor, canonicalLabel, shiftCanonical,
  type SizeCategory,
} from '@/lib/size-canonical'
import type { SizeAnswers } from '@/app/onboarding/actions'

// Sizes are asked PER CATEGORY, not once. Almost nobody is the same number top
// and bottom, and a single number would make the one-of-one filter — which
// hides pieces outright — wrong for most people most of the time.
//
// The "I also wear" row is what makes strictness humane: plenty of people are a
// 10 or a 12 depending on the cut, and an adjacent size SHE names is treated as
// a real match. We never infer one for her.

const CATEGORY_HELP: Record<SizeCategory, string> = {
  tops: 'Shirts, knitwear, dresses',
  bottoms: 'Trousers, jeans, skirts',
  outerwear: 'Coats, jackets, blazers',
  shoes: 'Boots, heels, flats',
}

export interface SizePickerValue {
  tops?: { value: number | null; adjacent: number | null }
  bottoms?: { value: number | null; adjacent: number | null }
  outerwear?: { value: number | null; adjacent: number | null }
  shoes?: { value: number | null; adjacent: number | null }
  acceptsSecondHand: boolean
}

export default function SizePicker({
  value,
  onChange,
  compact = false,
}: {
  value: SizePickerValue
  onChange: (next: SizePickerValue) => void
  compact?: boolean
}) {
  const [openHelp, setOpenHelp] = useState<SizeCategory | null>(null)

  function setSize(category: SizeCategory, size: number | null) {
    const current = value[category]
    onChange({
      ...value,
      [category]:
        size == null
          ? undefined
          : // Changing her main size clears an adjacent one that no longer sits
            // beside it — silently keeping a stale neighbour would widen the
            // match without her asking.
            { value: size, adjacent: isNeighbour(category, size, current?.adjacent ?? null) ? current?.adjacent ?? null : null },
    })
  }

  function setAdjacent(category: SizeCategory, size: number | null) {
    const current = value[category]
    if (!current?.value) return
    onChange({ ...value, [category]: { value: current.value, adjacent: current.adjacent === size ? null : size } })
  }

  return (
    <div className={compact ? 'space-y-7' : 'space-y-9'}>
      {SIZE_CATEGORIES.map((category) => {
        const ladder = ladderFor(category)
        const current = value[category]
        const neighbours = current?.value != null ? neighboursOf(category, current.value) : []
        return (
          <div key={category}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <p className="text-[15px] sm:text-[19px] tracking-[0.08em] text-[#4A4E57]">
                {CATEGORY_LABEL[category]}
              </p>
              <button
                type="button"
                onClick={() => setOpenHelp(openHelp === category ? null : category)}
                className="text-[13px] sm:text-[15px] tracking-[0.04em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors"
              >
                {openHelp === category ? 'Hide sizes' : 'Not sure?'}
              </button>
            </div>
            <p className="text-[14px] sm:text-[16px] text-[#A8A8A4] mb-3">{CATEGORY_HELP[category]}</p>

            {openHelp === category && current?.value != null && (
              <p className="text-[13px] sm:text-[15px] text-[#6B6B6B] mb-3 border-l-2 border-[#E2E0DB] pl-3">
                {canonicalLabel(current.value, category)}
              </p>
            )}
            {openHelp === category && current?.value == null && (
              <p className="text-[13px] sm:text-[15px] text-[#6B6B6B] mb-3 border-l-2 border-[#E2E0DB] pl-3">
                Pick a size and we&rsquo;ll show you what it is in every system.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {ladder.map((size) => {
                const active = current?.value === size
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setSize(category, active ? null : size)}
                    className={`min-w-[52px] px-4 py-2.5 rounded-[10px] border text-[15px] sm:text-[17px] tracking-[0.04em] transition-all duration-200 ${
                      active
                        ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                        : 'border-[#E2E0DB] bg-white text-[#4A4E57] hover:border-[#0A0A0A]'
                    }`}
                  >
                    {size}
                  </button>
                )
              })}
            </div>

            {current?.value != null && (
              <div className="mt-3">
                <p className="text-[14px] sm:text-[16px] text-[#6B6B6B] mb-2">
                  I also wear <span className="text-[#A8A8A4]">(optional)</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {neighbours.map((size) => {
                    const active = current.adjacent === size
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setAdjacent(category, size)}
                        className={`min-w-[52px] px-4 py-2 rounded-[10px] border text-[15px] tracking-[0.04em] transition-all duration-200 ${
                          active
                            ? 'border-[#C4A882] bg-[#C4A882] text-white'
                            : 'border-[#E2E0DB] bg-white text-[#6B6B6B] hover:border-[#C4A882]'
                        }`}
                      >
                        {size}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Second-hand consent. Opt-IN: silence is not a yes. */}
      <div className="border-t border-[#E2E0DB] pt-7">
        <p className="text-[15px] sm:text-[19px] tracking-[0.08em] text-[#4A4E57] mb-1">PRE-LOVED &amp; VINTAGE</p>
        <p className="text-[14px] sm:text-[16px] text-[#A8A8A4] mb-4 leading-relaxed max-w-[520px]">
          Would you like to be shown pre-loved and vintage pieces? They&rsquo;re one of a kind — when
          they sell, they&rsquo;re gone. You can change this any time.
        </p>
        <div className="flex gap-3">
          {[
            { label: 'YES, SHOW ME', on: true },
            { label: 'NO, NEW ONLY', on: false },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange({ ...value, acceptsSecondHand: opt.on })}
              className={`px-6 py-3 rounded-[10px] border text-[15px] sm:text-[17px] tracking-[0.06em] transition-all duration-200 ${
                value.acceptsSecondHand === opt.on
                  ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                  : 'border-[#E2E0DB] bg-white text-[#4A4E57] hover:border-[#0A0A0A]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The sizes either side on the ladder — the only adjacent options offered. */
function neighboursOf(category: SizeCategory, size: number): number[] {
  const down = shiftCanonical(size, category, -1)
  const up = shiftCanonical(size, category, 1)
  return Array.from(new Set([down, up])).filter((n) => n !== size)
}

const isNeighbour = (category: SizeCategory, size: number, adjacent: number | null): boolean =>
  adjacent != null && neighboursOf(category, size).includes(adjacent)

export const toSizeAnswers = (v: SizePickerValue): SizeAnswers => ({
  tops: v.tops,
  bottoms: v.bottoms,
  outerwear: v.outerwear,
  shoes: v.shoes,
  acceptsSecondHand: v.acceptsSecondHand,
})

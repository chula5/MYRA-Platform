'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { Outfit } from '@/types/database'

export interface LookbookSection {
  lookbook_id: string
  title: string
  slug: string
  outfits: Outfit[]
}

interface LookbookProps {
  lookbooks: LookbookSection[]
}

export default function Lookbook({ lookbooks }: LookbookProps) {
  const visible = lookbooks.filter((lb) => lb.outfits.length > 0)
  if (!visible.length) return null

  return (
    <section className="bg-white pt-20 pb-0">
      {visible.map((lb, sectionIndex) => (
        <div key={lb.lookbook_id} className={sectionIndex > 0 ? 'mt-20' : ''}>
          {/* Section heading */}
          <p className="text-left text-[22px] tracking-[0.22em] text-[#0A0A0A] mb-8 px-1">
            {lb.title.toUpperCase()}
          </p>

          {/* Alternating rows */}
          <div className="flex flex-col gap-[6px]">
            {buildRows(lb.outfits).map((row, rowIndex) =>
              row.mode === 'A' ? (
                <ThreePanelRow key={rowIndex} items={row.items} />
              ) : (
                <DualPanelRow key={rowIndex} items={row.items} />
              )
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

// ── Row builder ───────────────────────────────────────────────

function buildRows(outfits: Outfit[]): { mode: 'A' | 'B'; items: Outfit[] }[] {
  const rows: { mode: 'A' | 'B'; items: Outfit[] }[] = []
  let i = 0
  let modeToggle = true // true = Mode A (3), false = Mode B (2)

  while (i < outfits.length) {
    if (modeToggle) {
      const chunk = outfits.slice(i, i + 3)
      if (chunk.length > 0) rows.push({ mode: 'A', items: chunk })
      i += 3
    } else {
      const chunk = outfits.slice(i, i + 2)
      if (chunk.length > 0) rows.push({ mode: 'B', items: chunk })
      i += 2
    }
    modeToggle = !modeToggle
  }

  return rows
}

// ── Mode A — Three equal panels ───────────────────────────────

function ThreePanelRow({ items }: { items: Outfit[] }) {
  return (
    <div className="grid grid-cols-3 gap-[6px] overflow-x-auto scrollbar-hide">
      {items.map((outfit) => (
        <Link
          key={outfit.outfit_id}
          href={`/outfit/${outfit.outfit_id}`}
          className="lookbook-item relative block overflow-hidden group"
        >
          <div className="relative aspect-square w-full overflow-hidden image-hover-dim">
            <Image
              src={outfit.image_url || '/placeholder-outfit.jpg'}
              alt={outfit.aesthetic_label}
              fill
              className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]"
              sizes="(max-width: 768px) 100vw, 33vw"
            />
            {/* Hover label — fades in */}
            <div className="lookbook-label absolute bottom-0 left-0 right-0 p-3 text-center">
              <span className="text-white text-[12px] tracking-[0.15em]">
                {outfit.aesthetic_label}
              </span>
            </div>
          </div>
          {/* Below-image label */}
          <p className="mt-3 text-[22px] tracking-[0.18em] text-[#0A0A0A] px-1">
            {(outfit as any).celebrity_name || outfit.occasion_tags?.[0] || 'THE EDIT'}
          </p>
        </Link>
      ))}
    </div>
  )
}

// ── Mode B — Dual panel ───────────────────────────────────────

function DualPanelRow({ items }: { items: Outfit[] }) {
  return (
    <div className="grid grid-cols-2 gap-[6px] overflow-x-auto scrollbar-hide">
      {items.map((outfit) => (
        <Link
          key={outfit.outfit_id}
          href={`/outfit/${outfit.outfit_id}`}
          className="relative block overflow-hidden group aspect-[3/4]"
        >
          <Image
            src={outfit.image_url || '/placeholder-outfit.jpg'}
            alt={outfit.aesthetic_label}
            fill
            className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
          {/* Overlay gradient for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />

          {/* Label bottom-left */}
          <span className="absolute bottom-3 left-3 text-white text-[13px] tracking-[0.18em]">
            {outfit.aesthetic_label}
          </span>

          {/* Save icon bottom-right */}
          <button
            aria-label="Save outfit"
            onClick={(e) => e.preventDefault()}
            className="absolute bottom-3 right-3 text-white opacity-70 hover:opacity-100 transition-opacity duration-300"
          >
            <WishlistIcon />
          </button>
        </Link>
      ))}
    </div>
  )
}

function WishlistIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 13.5C8 13.5 2 9.5 2 5.5a3.5 3.5 0 0 1 6-2.45A3.5 3.5 0 0 1 14 5.5c0 4-6 8-6 8z" />
    </svg>
  )
}

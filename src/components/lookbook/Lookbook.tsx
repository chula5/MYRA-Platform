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
          <p className="text-left text-[14px] tracking-[0.22em] text-[#0A0A0A] mb-6 px-1">
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
  let modeToggle = true // true = prefer Mode A (3), false = Mode B (2)

  while (i < outfits.length) {
    const remaining = outfits.length - i
    if (modeToggle && remaining >= 3) {
      rows.push({ mode: 'A', items: outfits.slice(i, i + 3) })
      i += 3
    } else {
      rows.push({ mode: 'B', items: outfits.slice(i, i + 2) })
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
          <p className="mt-3 text-[10px] tracking-[0.15em] text-[#0A0A0A] px-1">
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
    <div className="grid grid-cols-2 gap-[6px]">
      {items.map((outfit) => (
        <Link
          key={outfit.outfit_id}
          href={`/outfit/${outfit.outfit_id}`}
          className="block group"
        >
          <div className="relative w-full aspect-[3/4] overflow-hidden">
            <Image
              src={outfit.image_url || '/placeholder-outfit.jpg'}
              alt={outfit.aesthetic_label}
              fill
              className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]"
              sizes="(max-width: 768px) 50vw, 50vw"
            />
          </div>
          <p className="mt-3 text-[10px] tracking-[0.15em] text-[#0A0A0A] px-1">
            {(outfit as any).celebrity_name || outfit.occasion_tags?.[0] || outfit.aesthetic_label}
          </p>
        </Link>
      ))}
    </div>
  )
}


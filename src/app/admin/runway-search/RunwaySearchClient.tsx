'use client'

import { useState } from 'react'
import { searchRunwayLooks, fetchLookImages, type RunwayLook } from '@/app/admin/ai/runway-search'

type LookWithImages = RunwayLook & { scrapedImages: string[] }

const QUICK_SEARCHES = [
  'Best AW26 looks across all brands',
  'Loewe AW26',
  'Miu Miu AW26',
  'Prada AW26',
  'The Row AW26',
  'Jacquemus AW26',
  'Toteme AW26',
  'Zimmermann AW26',
  'Acne Studios AW26',
  'Celine AW26',
]

export default function RunwaySearchClient() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ summary: string; looks: LookWithImages[] } | null>(null)

  async function handleSearch(q?: string) {
    const searchQuery = q ?? query
    if (!searchQuery.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    // Step 1: fast AI response (~2-3s with Haiku)
    const res = await searchRunwayLooks(searchQuery)
    setLoading(false)
    if (res.error) { setError(res.error); return }
    if (!res.data) return

    const initialLooks: LookWithImages[] = res.data.looks.map(look => ({ ...look, scrapedImages: [] }))
    setResult({ summary: res.data.summary, looks: initialLooks })

    // Step 2: fetch all images in parallel, update once all done
    const allImages = await Promise.all(
      res.data.looks.map(look => fetchLookImages(look.brand, look.season))
    )
    setResult(prev => {
      if (!prev) return prev
      return {
        ...prev,
        looks: prev.looks.map((look, i) => ({ ...look, scrapedImages: allImages[i] ?? [] }))
      }
    })
  }

  return (
    <div>
      {/* Search input */}
      <div className="mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="E.G. LOEWE AW26, BEST TAILORING LOOKS AW26, MIU MIU LATEST..."
            className="flex-1 border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.10em] text-[#0A0A0A] placeholder-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors"
          />
          <button
            onClick={() => handleSearch()}
            disabled={loading}
            className="bg-[#0A0A0A] text-white px-8 py-3 text-[11px] tracking-[0.20em] hover:bg-[#333] disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {loading ? 'SEARCHING...' : 'SEARCH →'}
          </button>
        </div>
      </div>

      {/* Quick search pills */}
      <div className="flex flex-wrap gap-2 mb-10">
        {QUICK_SEARCHES.map((s) => (
          <button
            key={s}
            onClick={() => { setQuery(s); handleSearch(s) }}
            disabled={loading}
            className="border border-[#E2E0DB] px-3 py-1.5 text-[10px] tracking-[0.15em] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors disabled:opacity-40"
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-[11px] tracking-[0.12em] text-red-500 mb-6">{error}</p>
      )}

      {loading && (
        <div className="py-20 text-center">
          <p className="text-[11px] tracking-[0.20em] text-[#A8A8A4] animate-pulse">
            ASKING AI FOR THE BEST LOOKS...
          </p>
        </div>
      )}

      {result && (
        <div>
          <p className="text-[11px] tracking-[0.15em] text-[#6B6B6B] mb-8 pb-4 border-b border-[#E2E0DB]">
            {result.summary.toUpperCase()}
          </p>
          <div className="grid grid-cols-2 gap-6">
            {result.looks.map((look) => (
              <LookCard key={look.letter} look={look} />
            ))}

          </div>
        </div>
      )}
    </div>
  )
}

function LookCard({ look }: { look: LookWithImages }) {
  const images = look.scrapedImages ?? []

  return (
    <div className="border border-[#E2E0DB] bg-white">
      {/* 2×2 image grid */}
      <div className="grid grid-cols-2 gap-[2px] bg-[#E2E0DB]">
        {[0, 1, 2, 3].map((i) => {
          const rawUrl = images[i]
          const imgUrl = rawUrl ? `/api/img?url=${encodeURIComponent(rawUrl)}` : null
          return imgUrl ? (
            <a
              key={i}
              href={look.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="relative aspect-square overflow-hidden bg-[#F2F2F0] group"
            >
              <img
                src={imgUrl}
                alt={`${look.brand} ${look.season} look ${i + 1}`}
                className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
              />
            </a>
          ) : (
            <div key={i} className="aspect-square bg-[#F2F2F0] flex items-center justify-center">
              <p className="text-[9px] tracking-[0.15em] text-[#D0D0CB]">LOADING</p>
            </div>
          )
        })}
      </div>

      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="text-[10px] tracking-[0.25em] text-[#A8A8A4]">LOOK {look.letter}</span>
            <p className="text-[14px] tracking-[0.15em] text-[#0A0A0A] mt-0.5">{look.brand.toUpperCase()}</p>
            <p className="text-[10px] tracking-[0.20em] text-[#6B6B6B]">{look.season}</p>
          </div>
          <span className="text-[10px] tracking-[0.15em] text-[#6B6B6B] italic">{look.mood}</span>
        </div>

        {/* Description */}
        <p className="text-[12px] tracking-[0.08em] text-[#0A0A0A] leading-relaxed mb-3">
          {look.description}
        </p>

        {/* Why interesting */}
        <p className="text-[11px] tracking-[0.08em] text-[#6B6B6B] leading-relaxed mb-5 italic">
          {look.whyInteresting}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-[#E2E0DB]">
          <a
            href={look.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors border border-[#E2E0DB] px-3 py-1.5 hover:border-[#0A0A0A]"
          >
            VIEW SOURCE →
          </a>
        </div>
      </div>
    </div>
  )
}

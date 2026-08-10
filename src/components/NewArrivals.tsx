import Link from 'next/link'
import type { OutfitWithItems } from '@/types/database'
import FallbackImage from '@/components/FallbackImage'

/**
 * NEW ARRIVALS — an editorial row of live looks at deliberately varied sizes,
 * embedded in the landing feed beneath the occasions (and, for signed-in users,
 * beneath their taste recommendations).
 *
 * The set of looks rotates on a fixed 2-day cadence: a new window of outfits
 * surfaces every two days, stepping through the full live catalogue, so the row
 * always feels fresh without any cron job or manual curation. It's a pure
 * function of the date, so it stays stable within each 2-day window (and matches
 * between server render and client hydration).
 */

const DAY_MS = 86_400_000
const COUNT = 4
// Rotate the shown looks through the most-recently-added pool, so the row always
// features genuinely new outfits while still changing every 2 days.
const RECENT_POOL = 20

/** Strip the auto-generated "COMPOSED · " prefix so captions read as clean labels. */
function cleanLabel(label?: string | null): string {
  if (!label) return ''
  return label.replace(/^COMPOSED\s*·\s*/i, '').trim()
}

/** Newest-added first. Uses created_at (published_at can be null / bulk-set). */
export function byNewest(a: OutfitWithItems, b: OutfitWithItems): number {
  return (b.created_at ?? '').localeCompare(a.created_at ?? '')
}

/**
 * Deterministic window that advances every 2 days. Walks forward from the
 * date-derived start index, skipping looks whose caption or image would repeat,
 * so the four shown are always visually distinct (adjacent catalogue outfits
 * are often composed around the same product and share a label).
 */
function rotatingWindow(outfits: OutfitWithItems[], count: number): OutfitWithItems[] {
  if (outfits.length === 0) return []
  const bucket = Math.floor(Date.now() / DAY_MS / 2) // increments once every 2 days
  const start = (bucket * count) % outfits.length
  const picks: OutfitWithItems[] = []
  const seenLabels = new Set<string>()
  const seenImages = new Set<string>()
  for (let i = 0; i < outfits.length && picks.length < count; i++) {
    const o = outfits[(start + i) % outfits.length]
    const label = cleanLabel(o.aesthetic_label).toUpperCase()
    if (seenLabels.has(label) || seenImages.has(o.image_url)) continue
    seenLabels.add(label)
    seenImages.add(o.image_url)
    picks.push(o)
  }
  return picks
}

// Per-column width (desktop only): differing widths give the varied,
// different-sized editorial rhythm; all images align to the top (no vertical
// offset). Mobile falls back to an even horizontal-scroll rail.
const SHAPES = [
  'sm:w-[24%]',
  'sm:w-[31%]',
  'sm:w-[40%]',
  'sm:w-[28%]',
]

export default function NewArrivals({
  outfits,
  hrefBase,
  onExplore,
  className = '',
}: {
  outfits: OutfitWithItems[]
  hrefBase: string
  /** Optional — when provided, the EXPLORE control opens the full live feed. */
  onExplore?: () => void
  className?: string
}) {
  // Draw from the most-recently-added outfits, then rotate a 2-day window
  // within that recent pool so the row is always new yet still changes.
  const newestRecent = outfits
    .filter((o) => o.image_url)
    .slice()
    .sort(byNewest)
    .slice(0, RECENT_POOL)
  const picks = rotatingWindow(newestRecent, COUNT)
  if (picks.length === 0) return null

  return (
    <div className={className}>
      {/* Section heading */}
      <div className="flex items-end justify-between mb-6">
        <p className="myra-section-label">NEW OUTFITS</p>
        {onExplore ? (
          <button
            onClick={onExplore}
            className="text-[9px] tracking-[0.072em] text-[#4A4E57] hover:text-[#4A4E57] transition-colors"
          >
            EXPLORE →
          </button>
        ) : (
          <span className="text-[9px] tracking-[0.072em] text-[#4A4E57]">UPDATED EVERY 2 DAYS</span>
        )}
      </div>

      {/* Varied-size image row: horizontal scroll on mobile, staggered on desktop */}
      <div className="flex gap-4 sm:gap-6 sm:items-start overflow-x-auto snap-x -mx-1 px-1 pb-2">
        {picks.map((o, i) => (
          <Link
            key={o.outfit_id}
            href={`${hrefBase}/${o.outfit_id}`}
            className={`group shrink-0 snap-start w-[70%] ${SHAPES[i % SHAPES.length]}`}
          >
            <FallbackImage
              src={o.image_url}
              thumbWidth={700}
              alt=""
              loading="lazy"
              className="w-full h-auto block group-hover:opacity-85 transition-opacity duration-500"
            />
          </Link>
        ))}
      </div>
    </div>
  )
}

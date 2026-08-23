import { loadWardrobeData } from './actions'
import WardrobeClient from './WardrobeClient'

export const dynamic = 'force-dynamic'
// Queue drains run inside server actions from this page; give them room.
export const maxDuration = 300

export default async function WardrobePage({ searchParams }: { searchParams?: { member?: string } }) {
  const data = await loadWardrobeData(searchParams?.member ?? null)
  return (
    <div>
      <p className="text-[10px] tracking-[0.2em] text-[#C4A882] mb-2">PRIVATE STYLIST</p>
      <h1 className="text-[22px] tracking-[0.06em] text-[#0A0A0A] mb-1">WARDROBE IMPORT</h1>
      <p className="text-[10px] tracking-[0.08em] text-[#6B6B6B] mb-8 max-w-3xl leading-relaxed">
        PHOTOS OF WHAT SHE ALREADY OWNS → DETECT EVERY GARMENT → CUT EACH ONE OUT ON WHITE → SCORE IT EXACTLY LIKE A RETAIL PIECE → YOU REVIEW → IT JOINS HER POOL, SO LOOKBOOKS STYLE NEW PIECES WITH WHAT SHE HAS. OWNED PIECES ARE HERS ALONE — NEVER THE FEED, NEVER ANOTHER CLIENT&rsquo;S POOL, NEVER STOCK-CHECKED OR AFFILIATE-LINKED.
      </p>
      <WardrobeClient data={data} />
    </div>
  )
}

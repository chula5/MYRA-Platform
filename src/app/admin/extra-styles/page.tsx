import { getReviewQueue } from '@/app/admin/outfit-review/actions'
import OutfitReviewClient from '@/app/admin/outfit-review/OutfitReviewClient'

export const dynamic = 'force-dynamic'

export default async function ExtraStylesPage() {
  const { anchors, brands, error } = await getReviewQueue(60, false, 'exactly-one')

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">EXTRA STYLE OUTFITS</h1>
        <p className="text-[11px] tracking-[0.06em] text-[#A8A8A4] mt-2 max-w-[680px] leading-relaxed">
          Anchor pieces that have been styled into exactly <span className="text-[#4A4E57]">one</span> outfit so far —
          give them more looks. For each, we propose fresh brand-coherent options: <span className="text-[#4A4E57]">SWAP</span>/
          <span className="text-[#4A4E57]">ADD</span> to tweak, tap <span className="text-[#4A4E57]">YES</span> to create the
          draft and trigger a Higgsfield shoot, or <span className="text-[#4A4E57]">SKIP</span>. Every YES and SKIP trains the Style Brain.
        </p>
        {error && <p className="mt-3 text-[10px] tracking-[0.12em] text-[#B83A3A]">{error.toUpperCase()}</p>}
        {!error && (
          <p className="mt-3 text-[11px] tracking-[0.12em] text-[#6B6B6B]">
            <span className="text-[#4A4E57]">{anchors.length}</span> PIECE{anchors.length === 1 ? '' : 'S'} WITH ONE OUTFIT
          </p>
        )}
      </div>

      <OutfitReviewClient anchors={anchors} brands={brands} mode="exactly-one" />
    </div>
  )
}

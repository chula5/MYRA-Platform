import { getReviewQueue } from './actions'
import OutfitReviewClient from './OutfitReviewClient'

export const dynamic = 'force-dynamic'

export default async function OutfitReviewPage() {
  // Coats and jackets are anchors here too ("fur coat outfits"); the
  // autonomous pipeline keeps to the garments.
  const { anchors, brands, types, colours, error } = await getReviewQueue(60, false, 'needs-more', null, { includeOuterwear: true })

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">OUTFIT REVIEW</h1>
        <p className="text-[11px] tracking-[0.06em] text-[#A8A8A4] mt-2 max-w-[680px] leading-relaxed">
          Anchor pieces (dresses, skirts, tops, trousers, coats and jackets) that don&rsquo;t yet have 3 outfits.
          Search, or filter by <span className="text-[#4A4E57]">brand</span>, <span className="text-[#4A4E57]">type</span> and
          <span className="text-[#4A4E57]"> colour</span> to build a run of looks around one kind of piece. For each, we
          propose brand-coherent looks — tap <span className="text-[#4A4E57]">YES</span> to create the draft and
          trigger a Higgsfield shoot (same as the Composer), or <span className="text-[#4A4E57]">SKIP</span>.
          Brand tiers are kept in band (high-street/contemporary not mixed with luxury/ultra; premium bridges).
        </p>
        {error && <p className="mt-3 text-[10px] tracking-[0.12em] text-[#B83A3A]">{error.toUpperCase()}</p>}
        {!error && (
          <p className="mt-3 text-[11px] tracking-[0.12em] text-[#6B6B6B]">
            <span className="text-[#4A4E57]">{anchors.length}</span> ANCHOR{anchors.length === 1 ? '' : 'S'} NEED REVIEW
          </p>
        )}
      </div>

      <OutfitReviewClient anchors={anchors} brands={brands} types={types} colours={colours} />
    </div>
  )
}

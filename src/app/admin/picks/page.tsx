import { listPicks, listPickBrands } from './actions'
import PicksClient from './PicksClient'

export const dynamic = 'force-dynamic'

export default async function AdminPicksPage() {
  const [initial, brands] = await Promise.all([listPicks(), listPickBrands()])
  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.2em] text-[#C4A882] mb-1">CURATION</p>
        <h1 className="text-[22px] tracking-[0.06em] text-[#0A0A0A]">OUR PICKS</h1>
        <p className="text-[11px] tracking-[0.06em] text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
          Curate the OUR PICKS section under New Outfits, and THE BAGS edit behind the headline bag.
          Order here is display order. Only live items appear publicly.
        </p>
      </div>
      <PicksClient initial={initial} brands={brands} />
    </div>
  )
}

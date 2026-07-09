import Link from 'next/link'
import { getStockFlaggedOutfits } from '@/app/admin/items/stock-impact'
import StockImpactClient from '@/app/admin/items/StockImpactClient'

export const dynamic = 'force-dynamic'

export default async function StockImpactPage() {
  const { outfits } = await getStockFlaggedOutfits()
  const outCount = outfits.filter((o) => o.hasOut).length
  const lowCount = outfits.filter((o) => o.hasLow && !o.hasOut).length

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">STOCK IMPACT</h1>
        <p className="mt-2 text-[10px] tracking-[0.068em] text-[#A8A8A4] max-w-2xl leading-relaxed">
          OUTFITS THAT CONTAIN A LOW-STOCK OR OUT-OF-STOCK ITEM. SEE WHAT&rsquo;S STILL IN STOCK, PULL AN OUTFIT TO
          DRAFT, SWAP THE FLAGGED PIECE FOR AN AVAILABLE ONE, THEN REGENERATE THE REFINED SHOOT.
        </p>
        <div className="mt-3 flex items-center gap-4 text-[10px] tracking-[0.09em]">
          {outCount > 0 && <span className="text-[#B83A3A]">{outCount} WITH OUT-OF-STOCK</span>}
          {lowCount > 0 && <span className="text-[#8B5E00]">{lowCount} WITH LOW STOCK</span>}
          <Link href="/admin/items?stock=flagged" className="text-[#6B6B6B] hover:text-[#0A0A0A]">← FLAGGED ITEMS</Link>
        </div>
      </div>

      <StockImpactClient outfits={outfits} />
    </div>
  )
}

import { loadStylistList, listBrandsForDemo } from './actions'
import StylistsClient from './StylistsClient'

export const dynamic = 'force-dynamic'

export default async function StylistsPage() {
  const [stylists, brands] = await Promise.all([loadStylistList(), listBrandsForDemo()])
  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.2em] text-[#C4A882] mb-1">ONE LIBRARY · MANY LENSES</p>
        <h1 className="text-[22px] tracking-[0.06em] text-[#0A0A0A]">STYLISTS</h1>
        <p className="text-[11px] tracking-[0.06em] text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
          Every stylist is a lens over the shared item library — their own constitution, vector
          envelope, item mask, learning state and autonomy stage. Never a separate inventory.
        </p>
      </div>
      <StylistsClient stylists={stylists} brands={brands} />
    </div>
  )
}

import { listBrandsForScan } from './actions'
import CollectionsClient from './CollectionsClient'

export const dynamic = 'force-dynamic'

export default async function CollectionsPage() {
  const { brands } = await listBrandsForScan()

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">DRAFT COLLECTIONS</h1>
        <p className="mt-2 text-[10px] tracking-[0.068em] text-[#A8A8A4] max-w-2xl leading-relaxed">
          CLICK A BRAND TO CHECK ITS WEBSITE FOR A NEW COLLECTION, OR SCAN ALL. ACCEPT THE PIECES YOU LIKE — EACH IS
          ADDED TO YOUR LIBRARY AND COMPOSED INTO OUTFIT OPTIONS. YES TRIGGERS THE REFINED SHOOT AND TRAINS THE STYLE BRAIN.
        </p>
      </div>

      <CollectionsClient brands={brands} />
    </div>
  )
}

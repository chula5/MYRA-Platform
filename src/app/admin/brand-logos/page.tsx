import { listBrandLogos } from './actions'
import BrandLogoManager from './BrandLogoManager'

export const dynamic = 'force-dynamic'

export default async function BrandLogosPage() {
  const rows = await listBrandLogos()

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">MYRA ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">BRAND LOGOS</h1>
        <p className="mt-3 max-w-[720px] text-[11px] tracking-[0.054em] text-[#6B6B6B] leading-relaxed">
          Most logos were found automatically from each house&apos;s own site. The big houses
          (Isabel Marant, Posse, Cult Gaia, Jacquemus, Saint Laurent) sit behind bot protection that
          refuses any automated fetch, so those need setting here — paste a direct image URL, or
          upload a file. Anything that looks wrong can be cleared, and the tile falls back to the
          brand name in type. Saving also applies the logo to any duplicate spelling of the same
          house.
        </p>
      </div>

      <BrandLogoManager initial={rows} />
    </div>
  )
}

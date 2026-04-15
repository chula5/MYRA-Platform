import RunwaySearchClient from './RunwaySearchClient'

export default function RunwaySearchPage() {
  return (
    <div>
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A] mb-1">SEARCH FOR NEW OUTFITS</h1>
        <p className="text-[11px] tracking-[0.15em] text-[#6B6B6B]">
          Search by brand, season, or describe what you're looking for. AI will surface the strongest looks as a shortlist.
        </p>
      </div>
      <RunwaySearchClient />
    </div>
  )
}

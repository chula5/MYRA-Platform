import { loadBrandWatch } from './actions'
import BrandWatchClient from './BrandWatchClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // full-catalogue scans run as this page's server actions

export default async function BrandWatchPage() {
  const data = await loadBrandWatch()

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">BRAND WATCH</h1>
        <p className="mt-2 text-[10px] tracking-[0.068em] text-[#A8A8A4] max-w-2xl leading-relaxed">
          EVERY MONDAY MYRA SCANS EACH WATCHED BRAND&rsquo;S FULL SHOPIFY CATALOGUE, SCORES NEW PIECES AGAINST THE
          HOUSE STYLE AND QUEUES THE ON-TASTE ONES HERE AS DRAFTS. KEEP MOVES A PIECE TO READY — SKIP ARCHIVES IT
          SO IT NEVER RESURFACES.
        </p>
      </div>

      {data.migrationNeeded ? (
        <div className="border border-[#E2E0DB] rounded-[10px] p-6 max-w-xl">
          <p className="text-[11px] tracking-[0.12em] text-[#4A4E57] mb-2">MIGRATION NEEDED</p>
          <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B] leading-relaxed">
            RUN <span className="text-[#C4A882]">supabase/migrations/0031_brand_watch.sql</span> IN THE SUPABASE SQL
            EDITOR, THEN RELOAD THIS PAGE.
          </p>
        </div>
      ) : (
        <BrandWatchClient watched={data.watched} queue={data.queue} queueTotal={data.queueTotal} predictedSkipTotal={data.predictedSkipTotal} decidedCount={data.decidedCount} brandCounts={data.brandCounts} />
      )}
    </div>
  )
}

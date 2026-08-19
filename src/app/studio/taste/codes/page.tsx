import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadCodesData } from './actions'
import CodesClient from './CodesClient'

export const dynamic = 'force-dynamic'

export default async function BrandCodesPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) redirect('/')

  const data = await loadCodesData()

  return (
    <div className="min-h-screen bg-[#FAFAF8] px-6 py-8 lg:px-10">
      <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">STUDIO · TASTE</p>
          <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">BRAND CODES</h1>
          <p className="mt-2 text-[10px] tracking-[0.068em] text-[#A8A8A4] max-w-2xl leading-relaxed">
            AUTHORED IDENTITY DIMENSIONS — SCORED BY HAND, NEVER RECOMPUTED. BLACK DOT = YOUR CODE ·
            GOLD RING = WHAT YOUR STOCKED BUY ACTUALLY SCORES (WHERE MAPPABLE).
          </p>
        </div>
        <a href="/studio/taste" className="text-[9px] tracking-[0.16em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">← TASTE INSPECTOR</a>
      </div>

      {data.migrationNeeded ? (
        <div className="border border-[#E2E0DB] rounded-[10px] p-6 max-w-xl bg-white">
          <p className="text-[11px] tracking-[0.12em] text-[#4A4E57] mb-2">MIGRATION NEEDED</p>
          <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B] leading-relaxed">
            RUN <span className="text-[#C4A882]">supabase/migrations/0036_brand_codes.sql</span> IN THE SUPABASE SQL
            EDITOR, THEN RELOAD THIS PAGE.
          </p>
        </div>
      ) : (
        <CodesClient dims={data.dims} brands={data.brands} />
      )}
    </div>
  )
}

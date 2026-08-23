import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { loadTasteInspector } from './actions'
import TasteClient from './TasteClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // vision scoring + health checks run as this page's actions

export default async function TasteInspectorPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) redirect('/')

  const data = await loadTasteInspector()

  return (
    <div className="min-h-screen bg-[#FAFAF8] px-6 py-8 lg:px-10">
      <div className="mb-8">
        <p className="text-[13px] tracking-[0.1em] text-[#6B6B6B] mb-2">STUDIO</p>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">TASTE INSPECTOR</h1>
        <p className="mt-2 text-[13px] tracking-[0.04em] text-[#A8A8A4] max-w-2xl leading-relaxed">
          BRAND MAP, PER-MEMBER AFFINITIES, ONBOARDING SIMULATOR AND HEALTH CHECKS — VERIFY THAT NAMING A BRAND
          EXPANDS TO THE RIGHT ADJACENT BRANDS BEFORE PILOT CUSTOMERS FEEL IT.
        </p>
      </div>

      {data.migrationNeeded ? (
        <div className="border border-[#E2E0DB] rounded-[10px] p-6 max-w-xl bg-white">
          <p className="text-[13px] tracking-[0.1em] text-[#4A4E57] mb-2">MIGRATION NEEDED</p>
          <p className="text-[13px] tracking-[0.04em] text-[#6B6B6B] leading-relaxed">
            RUN THE BRAND MIGRATIONS (<span className="text-[#C4A882]">0032_brand_affinity.sql</span> AND{' '}
            <span className="text-[#C4A882]">0035_brand_price_position.sql</span>) IN THE SUPABASE SQL EDITOR,
            THEN RELOAD THIS PAGE.{data.error ? ` (${data.error.slice(0, 80).toUpperCase()})` : ''}
          </p>
        </div>
      ) : (
        <TasteClient data={data} />
      )}
    </div>
  )
}

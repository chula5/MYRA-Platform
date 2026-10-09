import { loadPilotData } from './actions'
import PrivateStylistClient from './PrivateStylistClient'

export const dynamic = 'force-dynamic'
// HER VIEW taps the same ways-to-wear actions as her pages: a minute, not seconds.
export const maxDuration = 60

export default async function PrivateStylistPage() {
  const data = await loadPilotData()
  return (
    // Break out of the admin shell's centred 1440px column so review evidence
    // uses the full viewport, with only the same small gutter at either edge.
    <div className="mx-[calc(50%-50vw)] w-screen px-4 sm:px-6">
      <div className="mb-8">
        <h1 className="text-[26px] tracking-[0.06em] text-[#0A0A0A]">PRIVATE STYLIST</h1>
      </div>
      {!data.ready && (
        <div className="border border-[#B83A3A] px-5 py-4 mb-8">
          <p className="text-[20px] tracking-[0.1em] text-[#B83A3A]">
            {data.missingMigration === '0030'
              ? 'MIGRATION 0030_PILOT_TASTE_EVENTS.SQL HAS NOT BEEN RUN — RUN IT IN SUPABASE, THEN RELOAD.'
              : 'MIGRATIONS 0029_PRIVATE_STYLIST.SQL + 0030_PILOT_TASTE_EVENTS.SQL HAVE NOT BEEN RUN — RUN BOTH IN SUPABASE, THEN RELOAD.'}
          </p>
        </div>
      )}
      <PrivateStylistClient data={data} />
    </div>
  )
}

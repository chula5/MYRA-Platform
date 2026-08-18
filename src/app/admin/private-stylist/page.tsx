import { loadPilotData } from './actions'
import PrivateStylistClient from './PrivateStylistClient'

export const dynamic = 'force-dynamic'

export default async function PrivateStylistPage() {
  const data = await loadPilotData()
  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.2em] text-[#C4A882] mb-1">ONE HOUSE · THREE ROOMS</p>
        <h1 className="text-[22px] tracking-[0.06em] text-[#0A0A0A]">PRIVATE STYLIST</h1>
        <p className="text-[11px] tracking-[0.06em] text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
          The always-on stylist pilot. A member is never assigned to a room — she has a weighting
          across all three, tilted by occasion, clamped by the formality floor on work days.
          Nothing here is visible on the live site.
        </p>
      </div>
      {!data.ready && (
        <div className="border border-[#B83A3A] px-5 py-4 mb-8">
          <p className="text-[11px] tracking-[0.1em] text-[#B83A3A]">
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

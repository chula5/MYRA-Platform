import { loadAuditEntries } from './actions'
import AuditClient from './AuditClient'

export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const entries = await loadAuditEntries(72)
  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.2em] text-[#C4A882] mb-1">AUTONOMY</p>
        <h1 className="text-[22px] tracking-[0.06em] text-[#0A0A0A]">AUDIT — AUTO-PUBLISHED OUTFITS</h1>
        <p className="text-[11px] tracking-[0.06em] text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
          Everything the system published without your explicit approval (Stage 2+). KEEP confirms it.
          SWAP or PULL unpublishes it AND demotes the autonomy stage immediately — the system re-earns
          trust from Stage 1.
        </p>
      </div>
      <AuditClient entries={entries} />
    </div>
  )
}

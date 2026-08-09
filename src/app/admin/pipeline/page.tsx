import { loadPipelineCards } from './actions'
import PipelineClient from './PipelineClient'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const { fast, standard, config } = await loadPipelineCards()

  const total = config.fast_lane_approvals
  const overrideRate = total ? config.fast_lane_overrides / total : 0

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] tracking-[0.2em] text-[#C4A882] mb-1">SELF-CRITIQUING COMPOSER</p>
        <h1 className="text-[22px] tracking-[0.06em] text-[#0A0A0A]">OUTFIT PIPELINE</h1>
        <p className="text-[11px] tracking-[0.06em] text-[#6B6B6B] mt-2 max-w-2xl leading-relaxed">
          Outfits are vector-scored and confidence-gated before they reach you. HIGH confidence →
          fast lane, one tap each, image pre-rendered. LOW confidence → standard lane with the
          reasons it scored low.
        </p>
      </div>

      {/* Gate stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'FAST-LANE THRESHOLD', value: (config.fast_lane_threshold * 100).toFixed(0) },
          { label: 'FAST-LANE DECISIONS', value: String(total) },
          { label: 'OVERRIDE RATE', value: `${(overrideRate * 100).toFixed(0)}%` },
          { label: 'CLEAN STREAK', value: String(config.clean_streak) },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[10px] p-4">
            <p className="text-[18px] tracking-[0.04em] text-[#4A4E57]">{s.value}</p>
            <p className="text-[8px] tracking-[0.16em] text-[#A8A8A4] mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <PipelineClient fast={fast} standard={standard} />
    </div>
  )
}

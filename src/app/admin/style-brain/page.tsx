import { loadStyleModel, loadHouseStyle, loadDecisionStats } from '@/lib/style-brain-store'
import RecomputeButton from './RecomputeButton'

export const dynamic = 'force-dynamic'

export default async function StyleBrainPage() {
  const [model, house, stats] = await Promise.all([loadStyleModel(), loadHouseStyle(), loadDecisionStats()])
  const learnedPairs = Object.keys(model.pairs).length
  const tableReady = house.ready

  // "Getting smarter" signals.
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const enoughForTrend = (stats?.total ?? 0) >= 10
  const trendDelta = stats ? Math.round((stats.recentRate - stats.earlyRate) * 100) : 0
  // How much the learned model now steers the composer (ramps to full at 40).
  const learningStrength = Math.min(100, Math.round((model.decisions / 40) * 100))

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">STYLE BRAIN</h1>
        <p className="text-[11px] tracking-[0.059em] text-[#A8A8A4] mt-1 max-w-[640px] leading-relaxed">
          Every time you click YES (or SKIP) in the Composer and Outfit Review, MYRA learns which
          combinations you like — and re-ranks future suggestions toward your taste. The more you
          approve, the smarter it gets.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'DECISIONS', value: Math.round(model.decisions), sub: 'YES + SKIP LOGGED' },
          { label: 'APPROVALS', value: Math.round(model.approves), sub: 'OUTFITS YOU LIKED' },
          { label: 'SKIPS', value: Math.round(model.skips), sub: 'PASSED OVER' },
          { label: 'PAIRINGS LEARNED', value: learnedPairs, sub: 'ATTRIBUTE COMBINATIONS' },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label}</p>
            <p className="text-[28px] tracking-[0.023em] text-[#4A4E57] leading-none">{s.value}</p>
            <p className="text-[8px] tracking-[0.072em] text-[#C4A882] mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Is it getting smarter? */}
      {stats && stats.total > 0 && (
        <div className="mb-10">
          <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-1">IS IT GETTING SMARTER?</p>
          <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mb-4 max-w-[720px] leading-relaxed">
            As it learns your taste, the composer surfaces outfits you approve more often. These rise over time —
            they need ~20+ decisions to settle.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'APPROVAL RATE', value: pct(stats.approvalRate), sub: 'SHARE OF OPTIONS YOU APPROVE' },
              {
                label: 'TREND',
                value: enoughForTrend ? `${trendDelta >= 0 ? '↑' : '↓'} ${Math.abs(trendDelta)} PTS` : '—',
                sub: enoughForTrend ? `RECENT ${pct(stats.recentRate)} VS ${pct(stats.earlyRate)} EARLY` : 'NEEDS ~10+ DECISIONS',
                good: trendDelta >= 0,
              },
              { label: 'OUTFIT QUALITY', value: stats.avgApprovedScore != null ? pct(stats.avgApprovedScore) : '—', sub: 'AVG COHERENCE OF KEPT OUTFITS' },
              { label: 'LEARNING STRENGTH', value: `${learningStrength}%`, sub: 'HOW MUCH IT STEERS THE COMPOSER' },
            ].map((s: any) => (
              <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
                <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label}</p>
                <p className={`text-[28px] tracking-[0.023em] leading-none ${s.good === false ? 'text-[#B83A3A]' : 'text-[#4A4E57]'}`}>{s.value}</p>
                <p className="text-[8px] tracking-[0.072em] text-[#C4A882] mt-1">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* House Style doc */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-7 mb-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B]">HOUSE STYLE</p>
          <RecomputeButton />
        </div>
        {model.decisions < 1 ? (
          <p className="text-[11px] tracking-[0.06em] text-[#A8A8A4] leading-relaxed py-6">
            Nothing learned yet. Approve a few outfits in the Composer or Outfit Review and your
            house style — favourite brands, the colour and brand pairings you reach for, how you mix
            high and low — appears here, and starts steering the composer.
          </p>
        ) : (
          <MarkdownLite md={house.md} />
        )}
      </div>

      {!tableReady && (
        <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-5 max-w-[640px]">
          <p className="text-[11px] tracking-[0.081em] text-[#8A7A4E] mb-2">RUN MIGRATION TO ENABLE LEARNING</p>
          <p className="text-[10px] tracking-[0.054em] text-[#8A7A4E] leading-relaxed">
            Run <span className="font-mono">0016_style_brain.sql</span> in Supabase. Until then the composer
            still works — it just isn&rsquo;t learning yet.
          </p>
        </div>
      )}
    </div>
  )
}

// Minimal markdown renderer for the generated House Style doc (# / ## / - / _italic_ / **bold**).
function MarkdownLite({ md }: { md: string }) {
  const lines = md.split('\n')
  return (
    <div className="space-y-1.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd()
        if (!line.trim()) return <div key={i} className="h-2" />
        if (line.startsWith('## ')) return <p key={i} className="text-[11px] tracking-[0.1em] text-[#4A4E57] pt-3">{line.slice(3).toUpperCase()}</p>
        if (line.startsWith('# ')) return <p key={i} className="text-[14px] tracking-[0.05em] text-[#4A4E57]">{inline(line.slice(2))}</p>
        if (line.startsWith('- ')) return <p key={i} className="text-[11px] tracking-[0.04em] text-[#6B6B6B] pl-3">· {inline(line.slice(2))}</p>
        return <p key={i} className="text-[11px] tracking-[0.04em] text-[#A8A8A4] italic">{inline(line)}</p>
      })}
    </div>
  )
}
function inline(s: string) {
  // strip _italic_ and render **bold** as a styled span
  const parts = s.replace(/_/g, '').split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <span key={i} className="text-[#4A4E57]">{p.slice(2, -2)}</span>
      : <span key={i}>{p}</span>,
  )
}

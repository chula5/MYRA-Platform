import { loadStyleModel, loadHouseStyle, loadDecisionStats, loadCatalogueBalance, loadTasteSpread, loadRecentSwaps, loadSiteTasteProfile } from '@/lib/style-brain-store'
import { buildHouseStyle } from '@/lib/style-brain'
import { loadQuarantinedItems, loadSwapRules, loadPipelineConfig } from '@/lib/pipeline-store'
import { loadLatestCalibrationReport } from '@/lib/calibration'
import { CONSTITUTION_ARTICLES } from '@/lib/house-style'
import { loadHouseRejectionStats, loadMaterialPairTable, loadSelectionStats } from '@/lib/house-style-store'
import { loadFlaggedRenders } from '@/app/admin/ai/render-fidelity'
import RecomputeButton from './RecomputeButton'
import { QuarantinePanel, ReportButton } from './QuarantinePanel'
import TasteRadar from '@/components/admin/TasteRadar'

export const dynamic = 'force-dynamic'

export default async function StyleBrainPage() {
  const [model, house, stats, balance, spread, swaps, taste, quarantine, swapRules, pipelineCfg, calibration, houseRejects, pairTable, flaggedRenders, selectionStats] = await Promise.all([
    loadStyleModel(), loadHouseStyle(), loadDecisionStats(), loadCatalogueBalance(), loadTasteSpread(), loadRecentSwaps(), loadSiteTasteProfile(),
    loadQuarantinedItems(), loadSwapRules(12), loadPipelineConfig(), loadLatestCalibrationReport(),
    loadHouseRejectionStats(30), loadMaterialPairTable(20), loadFlaggedRenders(8), loadSelectionStats(),
  ])
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

      {/* Stat cards — genuine approve/skip from the log; swaps shown separately */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        {[
          { label: 'DECISIONS', value: stats ? stats.total : Math.round(model.decisions), sub: 'YES + SKIP LOGGED' },
          { label: 'APPROVALS', value: stats ? stats.approves : Math.round(model.approves), sub: 'OUTFITS YOU LIKED' },
          { label: 'SKIPS', value: stats ? stats.skips : Math.round(model.skips), sub: 'OPTIONS PASSED OVER' },
          { label: 'SWAPS', value: stats ? stats.swaps : 0, sub: 'PIECES SWAPPED / REMOVED' },
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
          <MarkdownLite md={buildHouseStyle(model)} />
        )}
      </div>

      {/* Site taste profile — the vector, graphed across labelled axes */}
      {taste && taste.axes.length > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-6">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-1">SITE TASTE PROFILE · {taste.n} LIVE OUTFITS</p>
          <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mb-4 max-w-[720px] leading-relaxed">
            The outfit taste-vector graphed across style axes. Gold = your catalogue (what you&rsquo;ve built);
            {taste.hasPeople ? ' dashed = what visitors actually view (weighted by clicks). Where the dashed shape bulges past the gold, demand is pulling toward a style you have less of.' : ' the view-weighted “what people lean to” shape appears once outfits get views.'}
          </p>
          <TasteRadar axes={taste.axes} hasPeople={taste.hasPeople} />

          {/* Distribution: % of outfits low / mid / high on each axis */}
          <div className="mt-8 border-t border-[#F2F2F2] pt-6">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B]">TASTE DISTRIBUTION</p>
              <p className="text-[8px] tracking-[0.072em] text-[#A8A8A4]">LOW · MID · HIGH SCORE</p>
            </div>
            <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mb-4">
              Share of your {taste.n} live outfits scoring low, mid or high on each style axis — e.g. how much of the
              collection is genuinely dressy vs casual.
            </p>
            <div className="space-y-2.5">
              {taste.axes.map((a) => {
                const lo = Math.round(a.low * 100), mid = Math.round(a.mid * 100), hi = Math.round(a.high * 100)
                return (
                  <div key={a.label} className="flex items-center gap-3">
                    <span className="text-[10px] tracking-[0.045em] text-[#4A4E57] w-[150px] flex-shrink-0 truncate">{a.label}</span>
                    <div className="flex-1 h-[14px] rounded-full overflow-hidden flex bg-[#F2F2F2]" title={`low ${lo}% · mid ${mid}% · high ${hi}%`}>
                      {a.low > 0 && <div className="h-full bg-[#E4E1DA] flex items-center justify-center" style={{ width: `${a.low * 100}%` }}>{lo >= 12 && <span className="text-[7px] text-[#8A8A86]">{lo}%</span>}</div>}
                      {a.mid > 0 && <div className="h-full bg-[#D8C39A] flex items-center justify-center" style={{ width: `${a.mid * 100}%` }}>{mid >= 12 && <span className="text-[7px] text-[#6B5A34]">{mid}%</span>}</div>}
                      {a.high > 0 && <div className="h-full bg-[#B7924F] flex items-center justify-center" style={{ width: `${a.high * 100}%` }}>{hi >= 12 && <span className="text-[7px] text-white">{hi}%</span>}</div>}
                    </div>
                    <span className="text-[9px] tracking-[0.045em] text-[#4A4E57] w-[42px] text-right flex-shrink-0">{hi}% hi</span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 mt-4">
              <span className="flex items-center gap-1.5 text-[8px] tracking-[0.08em] text-[#A8A8A4]"><span className="w-3 h-[8px] bg-[#E4E1DA] rounded-sm inline-block" /> LOW</span>
              <span className="flex items-center gap-1.5 text-[8px] tracking-[0.08em] text-[#A8A8A4]"><span className="w-3 h-[8px] bg-[#D8C39A] rounded-sm inline-block" /> MID</span>
              <span className="flex items-center gap-1.5 text-[8px] tracking-[0.08em] text-[#A8A8A4]"><span className="w-3 h-[8px] bg-[#B7924F] rounded-sm inline-block" /> HIGH</span>
            </div>
          </div>
        </div>
      )}

      {/* ── HOUSE STYLE CONSTITUTION ── */}
      <div className="border border-[#0A0A0A] bg-white rounded-[12px] p-7 mb-6">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">HOUSE STYLE CONSTITUTION</p>
        <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mb-5 max-w-[720px] leading-relaxed">
          Generative principles and hard constraints applied BEFORE vector scoring — the composer builds from
          these, then the confidence gate scores the result. Written rules override learned statistics.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          {CONSTITUTION_ARTICLES.map((a) => (
            <div key={a.title}>
              <p className="text-[10px] tracking-[0.12em] text-[#4A4E57] mb-1.5">{a.title.toUpperCase()}</p>
              {a.rules.map((r, i) => (
                <p key={i} className="text-[10px] tracking-[0.03em] text-[#6B6B6B] leading-relaxed pl-3">· {r}</p>
              ))}
            </div>
          ))}
        </div>

        {/* Why candidates were rejected before scoring (last 30 days) */}
        {houseRejects.length > 0 && (
          <div className="mt-6 border-t border-[#F2F2F2] pt-5">
            <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-3">RULES DOING THE MOST WORK · LAST 30 DAYS</p>
            <div className="flex flex-wrap gap-2">
              {houseRejects.slice(0, 10).map((r) => (
                <span key={r.code} className="border border-[#E2E0DB] rounded-full px-3 py-1 text-[9px] tracking-[0.06em] text-[#6B6B6B]">
                  {(r.rule ?? r.code).toUpperCase()} <span className="text-[#C4A882]">×{r.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Learned material pairing table */}
        {pairTable.length > 0 && (
          <div className="mt-6 border-t border-[#F2F2F2] pt-5">
            <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-3">MATERIAL PAIRINGS LEARNED FROM YOUR DECISIONS</p>
            <div className="space-y-1">
              {pairTable.map((p) => (
                <div key={p.pair_key} className="flex items-center gap-3 text-[10px] tracking-[0.04em]">
                  <span className="text-[#4A4E57] w-[180px] truncate">{p.family_a} + {p.family_b}</span>
                  <span className="text-[#3D7A50]">{p.approvals} kept</span>
                  <span className="text-[#B83A3A]">{p.rejections} swapped out</span>
                  {p.verdict && <span className="text-[8px] tracking-[0.1em] text-[#C4A882]">{p.verdict.toUpperCase()}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Collection selection signal */}
        {selectionStats && selectionStats.total > 0 && (
          <div className="mt-6 border-t border-[#F2F2F2] pt-5">
            <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-1">COLLECTION SELECTION SIGNAL</p>
            <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mb-3">
              WHAT YOU INGEST VS PASS OVER WHEN SCANNING COLLECTIONS — {selectionStats.selected} OF {selectionStats.total} CANDIDATES TAKEN ({Math.round(selectionStats.rate * 100)}%)
            </p>
            <div className="flex flex-wrap gap-2">
              {selectionStats.byBrand.slice(0, 8).map((b) => (
                <span key={b.brand} className="border border-[#E2E0DB] rounded-full px-3 py-1 text-[9px] tracking-[0.06em] text-[#6B6B6B]">
                  {b.brand.toUpperCase()} {b.taken}/{b.offered}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Renders that failed the fidelity check twice */}
      {flaggedRenders.length > 0 && (
        <div className="border border-[#E8B4B4] bg-[#FBF0F0] rounded-[12px] p-6 mb-6">
          <p className="text-[10px] tracking-[0.099em] text-[#9A4A4A] mb-1">RENDERS FLAGGED — FAILED THE FIDELITY CHECK TWICE</p>
          <p className="text-[9px] tracking-[0.06em] text-[#9A4A4A]/75 mb-4 max-w-[720px] leading-relaxed">
            These Higgsfield renders misrepresented the clothes (colour, silhouette, cut or length) on both
            attempts, so they were NOT promoted to the outfit&rsquo;s display image. Open the outfit to re-shoot or fix manually.
          </p>
          <div className="space-y-2">
            {flaggedRenders.map((r) => (
              <div key={r.image_url} className="text-[10px] tracking-[0.04em] text-[#6B6B6B]">
                <a href={`/outfit/${r.outfit_id}`} className="text-[#4A4E57] underline">OUTFIT {r.outfit_id.slice(0, 8)}</a>
                {r.issues.slice(0, 2).map((iss, i) => (
                  <span key={i}> · {iss.item}: {iss.field} — expected {iss.expected}, saw {iss.seen}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quarantine — the "retire or keep?" list */}
      <QuarantinePanel items={quarantine} />

      {/* Directional swap rules learned from ejection deltas */}
      {swapRules.length > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-6">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-1">SWAP RULES LEARNED</p>
          <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mb-4">
            THE DIRECTION YOUR SWAPS KEEP MOVING IN, PER SLOT AND FORMALITY — E.G. COLOUR: CREAM → BLACK IN DRESSY LOOKS
          </p>
          <div className="space-y-1.5">
            {swapRules.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] tracking-[0.03em]">
                <span className="text-[9px] tracking-[0.08em] text-[#A8A8A4] w-[130px] flex-shrink-0 truncate">
                  {r.slot.toUpperCase()} · {r.formality_band.toUpperCase()}
                </span>
                <span className="text-[#6B6B6B]">{r.dimension.replace(/_/g, ' ').toUpperCase()}</span>
                <span className="text-[#6B6B6B] line-through truncate">{String(r.from_value).toUpperCase()}</span>
                <span className="text-[#A8A8A4]">→</span>
                <span className="text-[#4A4E57] truncate">{String(r.to_value).toUpperCase()}</span>
                <span className="text-[8px] tracking-[0.06em] text-[#C4A882] flex-shrink-0">×{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly calibration report */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-6">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B]">WEEKLY CALIBRATION REPORT</p>
          <ReportButton />
        </div>
        <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mb-4">
          RUNS EVERY MONDAY 07:00 — FAST-LANE SHARE, OVERRIDE RATE (THRESHOLD {Math.round(pipelineCfg.fast_lane_threshold * 100)}), NEW QUARANTINES, TOP SWAP RULES, CATALOGUE GAPS
        </p>
        {calibration ? (
          <MarkdownLite md={calibration.report_md} />
        ) : (
          <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-2">
            No report yet — generate one now or wait for Monday&rsquo;s run.
          </p>
        )}
      </div>

      {/* Recent swaps — what got swapped out, for what, how different */}
      {swaps && swaps.total > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-6">
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B]">RECENT SWAPS</p>
            <p className="text-[9px] tracking-[0.072em] text-[#A8A8A4]">{swaps.total} SWAPS · {swaps.differentCount} TO A COMPLETELY DIFFERENT PIECE</p>
          </div>
          <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mb-4">WHAT YOU CHANGED WHILE BUILDING — TEACHES THE BRAIN WHAT YOU REACH PAST</p>
          <div className="space-y-2">
            {swaps.recent.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] tracking-[0.03em]">
                <span className="text-[#6B6B6B] line-through truncate max-w-[38%]">{s.from.toUpperCase()}</span>
                <span className="text-[#A8A8A4] flex-shrink-0">→</span>
                <span className="text-[#4A4E57] truncate max-w-[38%]">{s.to ? s.to.toUpperCase() : 'REMOVED'}</span>
                {s.different && <span className="text-[8px] tracking-[0.06em] text-[#C4A882] flex-shrink-0">· DIFFERENT</span>}
                {s.changed.length > 0 && <span className="text-[8px] tracking-[0.06em] text-[#A8A8A4] flex-shrink-0">({s.changed.join(', ')})</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Catalogue balance — distribution of the live collection */}
      {balance && balance.totalOutfits > 0 && (
        <div className="mb-6">
          <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-1">CATALOGUE BALANCE · {balance.totalOutfits} LIVE OUTFITS</p>
          <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mb-4 max-w-[720px] leading-relaxed">
            How your live outfits spread across occasions, colours, price and formality — spot where you&rsquo;re
            thin (a gap to build) or over-concentrated.
          </p>
          {spread && (
            <div className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4 mb-6 flex items-center justify-between max-w-[420px]">
              <div>
                <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">TASTE SPREAD</p>
                <p className="text-[28px] tracking-[0.023em] text-[#4A4E57] leading-none">{spread.n < 3 ? '—' : `${Math.round(spread.spread * 100)}%`}</p>
              </div>
              <div className="text-right">
                <p className={`text-[12px] tracking-[0.06em] ${spread.label === 'QUITE SAMEY' ? 'text-[#B83A3A]' : spread.label === 'GOOD RANGE' ? 'text-[#4A7A5A]' : 'text-[#6B6B6B]'}`}>{spread.label}</p>
                <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mt-1">DIVERSITY OF {spread.n} SCORED OUTFITS</p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BalancePanel title="BY OCCASION" rows={balance.occasions} unit="outfits" />
            <BalancePanel title="BY PRICE (PER ITEM)" rows={balance.priceBands.map((b) => [b.label, b.count] as [string, number])} unit="items" keepOrder />
            <BalancePanel title="BY COLOUR (PER ITEM)" rows={balance.colours} unit="items" />
            <BalancePanel title="BY FORMALITY" rows={balance.formality.map((f) => [f.label, f.count] as [string, number])} unit="outfits" keepOrder />
          </div>
        </div>
      )}

      {!tableReady && (
        <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-5 max-w-[640px]">
          <p className="text-[11px] tracking-[0.081em] text-[#8A7A4E] mb-2">RUN MIGRATION TO ENABLE LEARNING</p>
          <p className="text-[10px] tracking-[0.054em] text-[#8A7A4E] leading-relaxed">
            Run <span className="font-mono">0016_style_brain.sql</span> and{' '}
            <span className="font-mono">0020_self_critique_pipeline.sql</span> in Supabase. Until then the
            composer still works — it just isn&rsquo;t learning yet.
          </p>
        </div>
      )}
    </div>
  )
}

// A labelled bar list for the catalogue-balance panels. `keepOrder` preserves
// the given order (price bands, formality); otherwise sorts by count desc.
function BalancePanel({ title, rows, unit, keepOrder }: { title: string; rows: [string, number][]; unit: string; keepOrder?: boolean }) {
  const sorted = keepOrder ? rows : [...rows].sort((a, b) => b[1] - a[1])
  const shown = sorted.slice(0, 14)
  const max = Math.max(1, ...shown.map(([, n]) => n))
  return (
    <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-5">
      <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-4">{title}</p>
      {shown.length === 0 ? (
        <p className="text-[10px] tracking-[0.072em] text-[#A8A8A4] py-2">No data yet.</p>
      ) : (
        <div className="space-y-2">
          {shown.map(([label, n]) => (
            <div key={label}>
              <div className="flex justify-between mb-0.5">
                <span className="text-[10px] tracking-[0.04em] text-[#4A4E57] truncate pr-3">{label.toUpperCase()}</span>
                <span className="text-[9px] tracking-[0.045em] text-[#6B6B6B] flex-shrink-0">{n}</span>
              </div>
              <div className="h-[4px] bg-[#F2F2F2] rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${n === 0 ? 'bg-[#E8B4B4]' : 'bg-[#C4A882]'}`} style={{ width: `${Math.max(n === 0 ? 0 : 4, (n / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[8px] tracking-[0.063em] text-[#A8A8A4] mt-3">{unit.toUpperCase()}</p>
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

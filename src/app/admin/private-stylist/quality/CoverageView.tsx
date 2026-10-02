'use client'

// The Outfit Quality — Coverage view. Read-only reporting with every measure
// and dimension labeled by partition and context type. Sparse or missing
// segments show their sample size and a visible text warning; nothing here
// claims platform-wide confidence, and programme stages are manual guidance
// with no control that creates or starts work.

import { useCallback, useEffect, useState } from 'react'
import { loadCoverageAction } from './coverage-actions.gated'
import type { CoverageReport, CoverageSegment, CoverageDimension } from '@/lib/outfit-quality/coverage'

const DIMENSION_LABELS: Record<CoverageDimension, string> = {
  stylist: 'BY SELECTED STYLIST',
  evaluationProfile: 'BY EVALUATION PROFILE',
  realMember: 'BY REAL MEMBER',
  styleFamily: 'BY STYLE FAMILY',
  brandGroup: 'BY BRAND GROUP',
  occasion: 'BY OCCASION',
}

function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

function Warning({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <span role="status" className="text-[14px] tracking-[0.08em] text-[#9A7B45]">
      ⚠ {text}
    </span>
  )
}

function SegmentTable({ segments }: { segments: CoverageSegment[] }) {
  if (segments.length === 0) return null
  return (
    <table className="w-full text-left text-[16px]">
      <thead>
        <tr className="text-[13px] tracking-[0.14em] text-[#A8A8A4]">
          <th className="py-1 pr-3 font-normal">SEGMENT</th>
          <th className="py-1 pr-3 font-normal">CONTEXT</th>
          <th className="py-1 pr-3 font-normal">N</th>
          <th className="py-1 pr-3 font-normal">REVIEWED</th>
          <th className="py-1 pr-3 font-normal">ACCEPTED</th>
          <th className="py-1 pr-3 font-normal">ACCEPTANCE</th>
          <th className="py-1 pr-3 font-normal">MACHINE AGREES</th>
          <th className="py-1 font-normal">WARNING</th>
        </tr>
      </thead>
      <tbody>
        {segments.map((s) => (
          <tr key={s.key} className="border-t border-[#EDEBE6]">
            <td className="py-1 pr-3 text-[#0A0A0A]">{s.label}</td>
            <td className="py-1 pr-3 text-[#6B6B6B]">
              {s.contextTypes.length > 0 ? s.contextTypes.map((c) => (c === 'real_member' ? 'MEMBER' : 'PROFILE')).join(' + ') : '—'}
            </td>
            <td className="py-1 pr-3 text-[#6B6B6B]">{s.sampleSize}</td>
            <td className="py-1 pr-3 text-[#6B6B6B]">{s.reviewed}</td>
            <td className="py-1 pr-3 text-[#6B6B6B]">{s.accepted}</td>
            <td className="py-1 pr-3 text-[#0A0A0A]">{pct(s.acceptanceRate)}</td>
            <td className="py-1 pr-3 text-[#0A0A0A]">{pct(s.machineAgreement)}</td>
            <td className="py-1">
              <Warning text={s.warning} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function CoverageView() {
  const [report, setReport] = useState<CoverageReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setReport(await loadCoverageAction())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (error) {
    return <p className="text-[20px] tracking-[0.12em] text-[#B83A3A]">COVERAGE UNAVAILABLE: {error.toUpperCase()}</p>
  }
  if (!report) {
    return <p className="text-[20px] tracking-[0.12em] text-[#6B6B6B]">LOADING COVERAGE…</p>
  }

  return (
    <div>
      <p className="text-[16px] tracking-[0.08em] text-[#6B6B6B] mb-8">
        ALL FIGURES ARE LABELED BY PARTITION AND CONTEXT. THERE IS NO BLENDED PLATFORM-WIDE RATE; SPARSE SEGMENTS CARRY WARNINGS INSTEAD OF CONFIDENCE.
      </p>

      {/* ── Programme guidance (manual only) ─────────────────────────────── */}
      <section className="border border-[#E2E0DB] p-6 mb-10" aria-label="Programme guidance">
        <h2 className="text-[22px] tracking-[0.14em] text-[#0A0A0A] mb-3">PROGRAMME GUIDANCE — MANUAL ONLY</h2>
        <p className="text-[16px] tracking-[0.08em] text-[#6B6B6B] mb-4">{report.guidance.text}</p>
        <p className="text-[16px] tracking-[0.08em] text-[#6B6B6B] mb-4">
          OBSERVED DEVELOPMENT (TRAINING) REVIEWS SO FAR: {report.guidance.observedTrainingReviews}
        </p>
        <ul className="flex flex-col gap-2">
          {report.guidance.stages.map((s) => (
            <li key={s.stage} className="text-[16px] tracking-[0.08em] text-[#0A0A0A]">
              <span className="text-[#9A7B45]">{s.label}</span>
              {' — TARGET '}
              {s.targetApprox ? `≈${s.targetApprox.toLocaleString()}` : `${s.targetMin}–${s.targetMax}`}
              {' · '}
              {s.description}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Real-user trust (member contexts only) ───────────────────────── */}
      <section className="border border-[#E2E0DB] p-6 mb-10" aria-label="Real-user trust">
        <h2 className="text-[22px] tracking-[0.14em] text-[#0A0A0A] mb-1">{report.realUserTrust.label}</h2>
        <p className="text-[14px] tracking-[0.1em] text-[#A8A8A4] mb-3">PARTITIONS: {report.realUserTrust.partitionLabel} · CONTEXT: REAL MEMBERS ONLY</p>
        <p className="text-[16px] tracking-[0.08em] text-[#6B6B6B] mb-3">{report.realUserTrust.note}</p>
        <p className="text-[18px] tracking-[0.1em] text-[#0A0A0A]">
          n={report.realUserTrust.sampleSize} · REVIEWED {report.realUserTrust.reviewed} · ACCEPTED {report.realUserTrust.accepted} · ACCEPTANCE{' '}
          {pct(report.realUserTrust.acceptanceRate)}
        </p>
        <Warning text={report.realUserTrust.warning} />
      </section>

      {/* ── Per-partition blocks ─────────────────────────────────────────── */}
      {report.blocks.map((block) => (
        <section key={block.partition} className="border border-[#E2E0DB] p-6 mb-10" aria-label={`${block.partition} coverage`}>
          <h2 className="text-[22px] tracking-[0.14em] text-[#0A0A0A] mb-1">{block.label}</h2>
          <p className="text-[14px] tracking-[0.1em] text-[#A8A8A4] mb-4">
            ROLE: {block.releaseRole.toUpperCase()}
            {block.releaseRole === 'holdout' ? (block.included ? ' · OPENED' : ' · CLOSED') : ''}
          </p>
          <p className="text-[18px] tracking-[0.1em] text-[#0A0A0A] mb-1">
            VOLUME n={block.totals.sampleSize} · REVIEWED {block.totals.reviewed} · ACCEPTED {block.totals.accepted} · ACCEPTANCE{' '}
            {pct(block.totals.acceptanceRate)} · MACHINE AGREES {pct(block.totals.machineAgreement)} ({block.totals.machineComparisons} COMPARISONS)
          </p>
          <Warning text={block.totals.warning} />
          {Object.keys(block.totals.rejectionReasons).length > 0 && (
            <p className="mt-2 text-[16px] tracking-[0.08em] text-[#6B6B6B]">
              REJECTION REASONS:{' '}
              {Object.entries(block.totals.rejectionReasons)
                .map(([reason, count]) => `${reason.replace(/_/g, ' ').toUpperCase()} ×${count}`)
                .join(' · ')}
            </p>
          )}

          {(Object.keys(DIMENSION_LABELS) as CoverageDimension[]).map((dim) =>
            block.dimensions[dim].length === 0 ? null : (
              <div key={dim} className="mt-6">
                <h3 className="text-[16px] tracking-[0.16em] text-[#6B6B6B] mb-2">{DIMENSION_LABELS[dim]}</h3>
                <SegmentTable segments={block.dimensions[dim]} />
              </div>
            ),
          )}
        </section>
      ))}
    </div>
  )
}

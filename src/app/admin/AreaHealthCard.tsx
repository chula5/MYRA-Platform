import { STATUS } from '@/components/admin/charts/palette'
import type { AreaHealth } from '@/lib/dashboard-metrics'

const TONE_WORD: Record<AreaHealth['tone'], string> = {
  good: 'HEALTHY',
  warning: 'WATCH',
  critical: 'ACT',
  neutral: '—',
}

/**
 * One studio area, reduced to its single most telling number. The status word
 * next to the dot carries the meaning on its own — the colour is a shortcut for
 * people who can use it, never the only signal.
 */
export default function AreaHealthCard({ area }: { area: AreaHealth }) {
  const colour = STATUS[area.tone]

  return (
    <a
      href={area.href}
      className="
        group block bg-white border border-[#E2E0DB] rounded-[12px] p-5
        transition-all duration-300
        hover:border-[#0A0A0A] hover:shadow-[0_2px_16px_rgba(0,0,0,0.05)]
      "
    >
      <div className="flex items-center justify-between gap-2 mb-4">
        <p className="text-[10px] tracking-[0.113em] text-[#4A4E57] truncate">{area.label}</p>
        <span className="inline-flex items-center gap-1.5 flex-shrink-0">
          <span className="inline-block w-[6px] h-[6px] rounded-full" style={{ background: colour }} aria-hidden />
          <span className="text-[8px] tracking-[0.14em]" style={{ color: colour }}>
            {TONE_WORD[area.tone]}
          </span>
        </span>
      </div>

      <p className="text-[26px] tracking-[0.02em] leading-none text-[#4A4E57]">{area.value}</p>
      <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mt-2">{area.caption}</p>
      <p className="text-[9px] tracking-[0.054em] text-[#C9C7C2] mt-3 leading-relaxed">{area.detail}</p>

      <p className="mt-4 text-[9px] tracking-[0.14em] text-[#C9C7C2] group-hover:text-[#0A0A0A] transition-colors duration-300">
        OPEN →
      </p>
    </a>
  )
}

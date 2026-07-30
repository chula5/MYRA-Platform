'use client'

import { useState } from 'react'

interface DayData {
  date: string     // 'MMM D'
  isoDate: string  // 'YYYY-MM-DD'
  views: number
  clicks: number
}

export default function AnalyticsChart({ days }: { days: DayData[] }) {
  const [hovered, setHovered] = useState<number | null>(null)

  const maxVal = Math.max(...days.map(d => d.views), 1)

  // Space labels out, but anchor them to the END so the most recent day is
  // always labelled (otherwise the last few days sit past the final label and
  // the chart looks like it stops days early).
  const labelEvery = Math.ceil(days.length / 5)
  const showLabel = (i: number) => (days.length - 1 - i) % labelEvery === 0

  return (
    <div className="relative select-none">
      {/* Tooltip */}
      {hovered !== null && (
        <div
          className="absolute z-10 bg-[#0A0A0A] text-white text-[9px] tracking-[0.063em] px-2.5 py-1.5 rounded-[10px] pointer-events-none whitespace-nowrap"
          style={{
            left: `${(hovered / days.length) * 100}%`,
            transform: 'translateX(-50%)',
            top: '-36px',
          }}
        >
          {days[hovered].date} · {days[hovered].views} views · {days[hovered].clicks} clicks
        </div>
      )}

      {/* Bars */}
      <div className="flex items-end gap-[2px] h-[160px]">
        {days.map((d, i) => {
          const viewH = Math.round((d.views / maxVal) * 160)
          const clickH = Math.round((d.clicks / maxVal) * 160)
          const isHov = hovered === i
          return (
            <div
              key={d.isoDate}
              className="flex-1 flex flex-col justify-end cursor-pointer relative"
              style={{ height: '160px' }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Views bar */}
              <div
                className="w-full transition-colors duration-150"
                style={{
                  height: `${viewH}px`,
                  background: isHov ? '#C4A882' : '#E2E0DB',
                  minHeight: d.views > 0 ? '2px' : '0',
                }}
              />
              {/* Clicks bar overlaid at the bottom */}
              {d.clicks > 0 && (
                <div
                  className="absolute bottom-0 left-0 right-0"
                  style={{
                    height: `${Math.max(clickH, 2)}px`,
                    background: isHov ? '#333' : '#0A0A0A',
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex mt-2">
        {days.map((d, i) => (
          <div key={d.isoDate} className="flex-1 text-center">
            {showLabel(i) && (
              <span className="text-[8px] tracking-[0.036em] text-[#A8A8A4]">{d.date}</span>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-5 mt-4">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[#E2E0DB] inline-block" />
          <span className="text-[9px] tracking-[0.063em] text-[#6B6B6B]">PAGE VIEWS</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[#0A0A0A] inline-block" />
          <span className="text-[9px] tracking-[0.063em] text-[#6B6B6B]">CLICKS (CTA + SOCIAL)</span>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'

export interface Preview {
  key: string
  label: string
  title: string
  path: string
}

// Live, interactive mini-previews of MYRA pages. Each iframe renders the real
// page at a device width, scaled down to fit a frame — clicks/scrolls work, so
// you can drive a flow (and later have it recorded for a reel).
export default function ProductPreviews({ previews }: { previews: Preview[] }) {
  const [device, setDevice] = useState<'phone' | 'desktop'>('phone')
  const [nonce, setNonce] = useState(0) // bump to reload all frames

  const base = device === 'phone' ? { w: 390, h: 800 } : { w: 1280, h: 820 }
  const dispW = device === 'phone' ? 300 : 480
  const scale = dispW / base.w
  const dispH = Math.round(base.h * scale)

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B]">LIVE PREVIEWS · INTERACT DIRECTLY</p>
        <div className="flex items-center gap-2">
          <div className="flex border border-[#E2E0DB] rounded-[3px] overflow-hidden">
            {(['phone', 'desktop'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDevice(d)}
                className={`px-3 py-1.5 text-[9px] tracking-[0.16em] transition-colors ${
                  device === d ? 'bg-[#0A0A0A] text-white' : 'bg-white text-[#6B6B6B] hover:text-[#4A4E57]'
                }`}
              >
                {d.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={() => setNonce((n) => n + 1)}
            className="px-3 py-1.5 text-[9px] tracking-[0.16em] border border-[#E2E0DB] rounded-[3px] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors"
          >
            ↻ RELOAD
          </button>
        </div>
      </div>

      {/* Preview grid */}
      <div className="flex flex-wrap gap-6">
        {previews.map((p) => {
          const src = `${p.path}${p.path.includes('?') ? '&' : '?'}pv=${nonce}`
          return (
            <div key={p.key} className="flex flex-col" style={{ width: dispW }}>
              {/* Frame */}
              <div
                className="relative bg-white rounded-[14px] overflow-hidden border border-[#E2E0DB] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.3)]"
                style={{ width: dispW, height: dispH }}
              >
                <iframe
                  key={`${p.key}-${device}-${nonce}`}
                  src={src}
                  title={p.label}
                  style={{
                    width: base.w,
                    height: base.h,
                    border: 0,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }}
                />
              </div>
              {/* Caption */}
              <div className="mt-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">{p.label}</p>
                  <p className="text-[11px] tracking-[0.04em] text-[#4A4E57] leading-snug">{p.title}</p>
                </div>
                <a
                  href={p.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-[9px] tracking-[0.16em] text-[#6B6B6B] hover:text-[#4A4E57] border border-[#E2E0DB] hover:border-[#0A0A0A] rounded-[3px] px-2.5 py-1.5 transition-colors"
                >
                  OPEN ↗
                </a>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

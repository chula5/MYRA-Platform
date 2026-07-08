'use client'

import { useEffect, useState } from 'react'

// A one-time educational pop-out (bottom-right, mirror-led, dismissible). Shown
// the first time a visitor lands on a surface; remembered per `id` in
// localStorage so it never nags. Mirrors the SignupPrompt style.
export default function HelpPopover({
  id,
  title,
  points,
  delayMs = 900,
}: {
  id: string
  title: string
  points: { label: string; text: string }[]
  delayMs?: number
}) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let seen = false
    try { seen = localStorage.getItem(`myra_help_${id}`) === '1' } catch { /* ignore */ }
    if (seen) return
    const t = setTimeout(() => setShow(true), delayMs)
    return () => clearTimeout(t)
  }, [id, delayMs])

  function dismiss() {
    try { localStorage.setItem(`myra_help_${id}`, '1') } catch { /* ignore */ }
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed bottom-5 right-5 z-[60] w-[min(340px,calc(100vw-2.5rem))] animate-[fadeIn_0.4s_ease]">
      <div className="relative bg-white border border-[#E2E0DB] rounded-[16px] shadow-[0_8px_30px_rgba(0,0,0,0.14)] p-5">
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-2.5 right-3 text-[#A8A8A4] hover:text-[#4A4E57] text-[16px] leading-none"
        >
          ×
        </button>
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/myra-mirror-transparent.png" alt="" className="h-9 w-auto flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.09em] text-[#4A4E57] mb-3">{title}</p>
            <div className="space-y-2">
              {points.map((p) => (
                <p key={p.label} className="text-[10px] tracking-[0.04em] text-[#6B6B6B] leading-relaxed">
                  <span className="text-[#4A4E57]">{p.label}</span> — {p.text}
                </p>
              ))}
            </div>
            <button
              onClick={dismiss}
              className="inline-block mt-4 bg-[#0A0A0A] text-white px-4 py-2 rounded-full text-[10px] tracking-[0.12em] hover:opacity-85 transition-opacity"
            >
              GOT IT
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

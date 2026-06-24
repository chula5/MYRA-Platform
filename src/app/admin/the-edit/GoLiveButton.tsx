'use client'

import { useState } from 'react'

/**
 * GO LIVE control for The Edit.
 *
 * DEACTIVATED for now (by request). When enabled, this is where publishing The
 * Edit to the public site (/feed) will be wired up — flipping /feed from the
 * "Launching soon" placeholder to the real feed. Until then the button is locked
 * and explains what it will do.
 */
export default function GoLiveButton({ liveCount }: { liveCount: number }) {
  const [showInfo, setShowInfo] = useState(false)
  const disabled = true // ← keep deactivated until ready to publish publicly

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={disabled}
        title="Deactivated — turning this on publishes The Edit to your public site (/feed)"
        className="bg-[#0A0A0A] text-white px-7 py-3 text-[10px] tracking-[0.09em] rounded-[12px] opacity-40 cursor-not-allowed"
      >
        GO LIVE — PUBLISH THE EDIT · 🔒 LOCKED
      </button>
      <button
        type="button"
        onClick={() => setShowInfo((s) => !s)}
        className="text-[9px] tracking-[0.081em] text-[#6B6B6B] hover:text-[#4A4E57] underline"
      >
        WHAT DOES THIS DO?
      </button>
      {showInfo && (
        <p className="max-w-[320px] text-right text-[9px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed">
          When enabled, this publishes The Edit to your public site — the
          &ldquo;THE EDIT&rdquo; link on myra would show these {liveCount} live
          outfit{liveCount === 1 ? '' : 's'} instead of the &ldquo;Launching
          soon&rdquo; page. It is deactivated for now, so nothing here is visible
          to the public. Ask to enable it when you&rsquo;re ready.
        </p>
      )}
    </div>
  )
}

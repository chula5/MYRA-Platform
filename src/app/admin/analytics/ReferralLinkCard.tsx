'use client'

import { useState } from 'react'

export default function ReferralLinkCard({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  return (
    <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-1">{label}</p>
        <p className="text-[12px] tracking-[0.04em] text-[#0A0A0A] truncate font-mono">{url}</p>
      </div>
      <button
        onClick={copy}
        className="flex-shrink-0 border border-[#0A0A0A] text-[#0A0A0A] px-4 py-2 text-[9px] tracking-[0.18em] hover:bg-[#0A0A0A] hover:text-white transition-colors"
      >
        {copied ? 'COPIED ✓' : 'COPY'}
      </button>
    </div>
  )
}

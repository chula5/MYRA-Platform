'use client'

import { useState } from 'react'
import { repairLiveOutfitImages } from './repair-images-actions'

/**
 * One-click repair: re-hosts live outfits' display images on Cloudinary when
 * they still point at retailer/generation CDNs (the cause of broken images in
 * the public feed). Runs in small batches — keep clicking until it reports 0
 * remaining.
 */
export default function RepairImagesButton() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setStatus('REPAIRING…')
    try {
      const res = await repairLiveOutfitImages()
      if (res.error) setStatus(`ERROR: ${res.error}`)
      else if (res.repaired === 0 && res.failed === 0 && res.remaining === 0) setStatus('ALL IMAGES STABLE ✓')
      else setStatus(`REPAIRED ${res.repaired}${res.failed ? ` · FAILED ${res.failed}` : ''} · ${res.remaining} LEFT${res.remaining > 0 ? ' — CLICK AGAIN' : ' ✓'}`)
    } catch {
      setStatus('ERROR: repair failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      className="inline-flex items-center gap-2 border border-[#E2E0DB] text-[#6B6B6B] px-5 py-2.5 rounded-[12px] text-[10px] tracking-[0.09em] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-300 disabled:opacity-50"
    >
      ⟳ {status ?? 'REPAIR OUTFIT IMAGES'}
    </button>
  )
}

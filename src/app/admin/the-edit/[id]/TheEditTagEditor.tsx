'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateOutfitTags } from '@/app/admin/projects/actions'

// The same six occasions shown in The Edit. Keep in sync with
// PRESET_OCCASIONS in src/app/feed/FeedClient.tsx.
const PRESET_OCCASIONS = [
  { label: 'WEEKEND AWAY', tag: 'weekend away' },
  { label: 'WIMBLEDON', tag: 'wimbledon' },
  { label: 'WEDDING GUEST', tag: 'wedding guest' },
  { label: 'DATE NIGHT', tag: 'date night' },
  { label: 'CITY SUMMER EVENING', tag: 'city summer evening' },
  { label: 'CASUAL SUMMER WEEKEND', tag: 'casual summer weekend' },
]

function normalise(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)))
}

export default function TheEditTagEditor({
  outfitId,
  initialTags,
}: {
  outfitId: string
  initialTags: string[]
}) {
  const router = useRouter()
  const [tags, setTags] = useState<string[]>(normalise(initialTags ?? []))
  const [custom, setCustom] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function persist(next: string[]) {
    const clean = normalise(next)
    setTags(clean)
    setStatus('saving')
    setErrorMsg(null)
    const res = await updateOutfitTags(outfitId, clean)
    if (res?.error) {
      setStatus('error')
      setErrorMsg(res.error)
      return
    }
    setStatus('saved')
    router.refresh()
    setTimeout(() => setStatus('idle'), 2000)
  }

  function toggle(tag: string) {
    const t = tag.trim().toLowerCase()
    persist(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])
  }

  function addCustom() {
    const t = custom.trim().toLowerCase()
    if (!t) return
    setCustom('')
    if (!tags.includes(t)) persist([...tags, t])
  }

  // Tags that aren't one of the six presets (so they're still visible/removable).
  const presetTagSet = new Set(PRESET_OCCASIONS.map((o) => o.tag))
  const customTags = tags.filter((t) => !presetTagSet.has(t))

  return (
    <div className="border-b border-[#E2E0DB] bg-[#FAFAF8] px-5 py-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B]">OCCASION TAGS</p>
        <span className="text-[9px] tracking-[0.18em]">
          {status === 'saving' && <span className="text-[#A8A8A4]">SAVING…</span>}
          {status === 'saved' && <span className="text-[#3A6B3A]">✓ SAVED</span>}
          {status === 'error' && <span className="text-[#B83A3A]">{(errorMsg || 'SAVE FAILED').toUpperCase()}</span>}
        </span>
      </div>

      <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4] mb-3 leading-relaxed">
        Tap an occasion to add or remove it. Changes save instantly and update what shows under each
        occasion in The Edit.
      </p>

      {/* Preset occasion toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESET_OCCASIONS.map((occ) => {
          const active = tags.includes(occ.tag)
          return (
            <button
              key={occ.tag}
              type="button"
              onClick={() => toggle(occ.tag)}
              disabled={status === 'saving'}
              className={`px-3 py-2 text-[9px] tracking-[0.16em] rounded-[3px] border transition-colors disabled:opacity-50 ${
                active
                  ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                  : 'bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A] hover:text-[#0A0A0A]'
              }`}
            >
              {active ? '✓ ' : ''}{occ.label}
            </button>
          )
        })}
      </div>

      {/* Any custom (non-preset) tags currently on the outfit */}
      {customTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {customTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-2 px-3 py-2 text-[9px] tracking-[0.16em] rounded-[3px] border border-[#C4A882] bg-white text-[#0A0A0A]"
            >
              {t.toUpperCase()}
              <button
                type="button"
                onClick={() => toggle(t)}
                disabled={status === 'saving'}
                aria-label={`Remove ${t}`}
                className="text-[#A8A8A4] hover:text-[#B83A3A] text-[12px] leading-none disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add a custom tag */}
      <div className="flex gap-2 max-w-[420px]">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addCustom() }
          }}
          placeholder="ADD A CUSTOM OCCASION"
          className="flex-1 border border-[#E2E0DB] bg-white px-3 py-2 text-[10px] tracking-[0.12em] text-[#0A0A0A] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A]"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={status === 'saving' || !custom.trim()}
          className="shrink-0 border border-[#0A0A0A] text-[#0A0A0A] px-4 text-[9px] tracking-[0.18em] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40"
        >
          ADD
        </button>
      </div>
    </div>
  )
}

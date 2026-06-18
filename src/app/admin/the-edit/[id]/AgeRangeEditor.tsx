'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateOutfitAgeRanges } from '@/app/admin/projects/actions'
import { AGE_RANGES } from '@/app/onboarding/brand-groups'

export default function AgeRangeEditor({
  outfitId,
  initialAgeRanges,
}: {
  outfitId: string
  initialAgeRanges: string[]
}) {
  const router = useRouter()
  const [ranges, setRanges] = useState<string[]>(initialAgeRanges ?? [])
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function persist(next: string[]) {
    setRanges(next)
    setStatus('saving')
    setErrorMsg(null)
    const res = await updateOutfitAgeRanges(outfitId, next)
    if (res?.error) {
      setStatus('error')
      setErrorMsg(res.error)
      return
    }
    setStatus('saved')
    router.refresh()
    setTimeout(() => setStatus('idle'), 2000)
  }

  function toggle(range: string) {
    persist(ranges.includes(range) ? ranges.filter((r) => r !== range) : [...ranges, range])
  }

  return (
    <div className="border-b border-[#E2E0DB] bg-white px-5 py-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B]">AGE RANGES · ADMIN ONLY</p>
        <span className="text-[9px] tracking-[0.18em]">
          {status === 'saving' && <span className="text-[#A8A8A4]">SAVING…</span>}
          {status === 'saved' && <span className="text-[#3A6B3A]">✓ SAVED</span>}
          {status === 'error' && <span className="text-[#B83A3A]">{(errorMsg || 'SAVE FAILED').toUpperCase()}</span>}
        </span>
      </div>

      <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4] mb-3 leading-relaxed">
        Tag which age ranges this outfit suits. Used to show age-appropriate outfits during new-user
        sign-up. Never shown in The Edit. Leave empty = suitable for everyone.
      </p>

      <div className="flex flex-wrap gap-2">
        {AGE_RANGES.map((r) => {
          const active = ranges.includes(r)
          return (
            <button
              key={r}
              type="button"
              onClick={() => toggle(r)}
              disabled={status === 'saving'}
              className={`px-4 py-2 text-[10px] tracking-[0.14em] rounded-[3px] border transition-colors disabled:opacity-50 ${
                active
                  ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                  : 'bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A] hover:text-[#0A0A0A]'
              }`}
            >
              {active ? '✓ ' : ''}{r}
            </button>
          )
        })}
      </div>
    </div>
  )
}

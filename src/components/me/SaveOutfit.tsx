'use client'

// SAVE — an outfit she likes becomes one of her looks, and MYRA makes its
// picture. The save is instant; the picture takes minutes and lands here
// when it is done (for now the shoot follows the save — one day it will be
// made before she ever sees the outfit).

import { useEffect, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import type { LookItem } from '@/lib/pilot-stylist'
import { saveMyOutfit, myLookImage } from '@/app/me/ways/actions'

const T = 'text-[19px] xl:text-[22px] 2xl:text-[26px]'
const T_SMALL = 'text-[17px] xl:text-[20px] 2xl:text-[23px]'
const EVERY_MS = 6_000
const MAX_POLLS = 40

export default function SaveOutfit({
  items, why, occasion, testMemberId, label = 'Save this outfit',
}: {
  items: LookItem[]
  why?: string
  occasion?: string | null
  testMemberId?: string
  label?: string
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lookId, setLookId] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [waited, setWaited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  async function save() {
    setState('saving'); setError(null)
    const r = await saveMyOutfit(items, why ?? '', occasion ?? null, testMemberId)
    if (!live.current) return
    if (r.error || !r.lookId) { setState('error'); setError(r.error ?? 'Could not save this outfit'); return }
    setState('saved'); setLookId(r.lookId)
  }

  // The picture: polled while it is being made, shown the moment it lands.
  useEffect(() => {
    if (!lookId || imageUrl) return
    let n = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      n++
      try {
        const r = await myLookImage(lookId, testMemberId)
        if (!live.current) return
        if (r.imageUrl) { setImageUrl(r.imageUrl); return }
      } catch { /* try again */ }
      if (n < MAX_POLLS) timer = setTimeout(tick, EVERY_MS)
      else setWaited(true)
    }
    timer = setTimeout(tick, EVERY_MS)
    return () => { if (timer) clearTimeout(timer) }
  }, [lookId, imageUrl, testMemberId])

  if (state === 'saved') {
    return (
      <div className="space-y-3">
        {imageUrl ? (
          <div className="relative aspect-[3/4] bg-[#E4E2DD] rounded-[14px] overflow-hidden">
            <FallbackImage src={imageUrl} thumbWidth={900} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </div>
        ) : (
          <div className="flex items-center gap-4">
            {!waited && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-12 w-auto" />
            )}
            <p className={`${T_SMALL} text-[#4A4E57]`}>
              {waited ? 'Saved to your looks. Its picture will appear there when it is ready.' : 'Saved to your looks · MYRA is making its picture…'}
            </p>
          </div>
        )}
        {imageUrl && <p className={`${T_SMALL} text-[#6E6B65]`}>Saved to your looks.</p>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <button
        type="button"
        disabled={state === 'saving'}
        onClick={() => void save()}
        className={`${T} px-6 py-3 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40`}
      >
        {state === 'saving' ? 'Saving…' : label}
      </button>
      {error && <p className={`${T_SMALL} text-[#9B3A3A]`}>{error}</p>}
    </div>
  )
}

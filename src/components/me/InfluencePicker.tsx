'use client'

// WHOSE STYLE DO YOU LOVE — portraits she recognises and taps, like the brand
// picker: no thinking of names. Each one chosen sits on top of her stylist and
// pulls her looks towards that person's eye. Shows nothing until Chloe has
// made someone live.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { loadMyInfluences, setMyInfluence, type InfluencePickerView } from '@/app/me/influence-actions'

export default function InfluencePicker({ testMemberId, heading = true, className }: { testMemberId?: string; heading?: boolean; className?: string }) {
  const [view, setView] = useState<InfluencePickerView | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    void loadMyInfluences(testMemberId).then((v) => { if (alive) { setView(v); setChosen(new Set(v.chosen)) } })
    return () => { alive = false }
  }, [testMemberId])

  if (!view?.people.length) return null

  async function toggle(id: string) {
    const on = !chosen.has(id)
    const next = new Set(chosen)
    if (on) next.add(id); else next.delete(id)
    setChosen(next)
    const r = await setMyInfluence(id, on, testMemberId)
    if (r.error) setChosen(chosen) // put it back; nothing was saved
  }

  return (
    <div className={className}>
      {heading && (
        <div className="text-center mb-6">
          <h2 className="text-[clamp(26px,2.2vw,48px)] text-[#2B2B2B]">Whose style do you love?</h2>
          <p className="text-[clamp(20px,1.1vw,28px)] text-[#4A4E57] mt-2">Tap anyone who inspires you. MYRA styles you with their eye, in pieces you can buy.</p>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
        {view.people.map((p) => {
          const on = chosen.has(p.id)
          return (
            <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on}
              className={`group text-left rounded-[16px] overflow-hidden bg-white transition-shadow ${on ? 'ring-2 ring-[#2B2B2B] shadow-[0_12px_28px_-16px_rgba(43,43,43,0.6)]' : 'ring-1 ring-[rgba(43,43,43,0.12)] hover:ring-[#7C838B]'}`}>
              <div className="relative aspect-[3/4] bg-[#E4E2DD]">
                {p.image_url && <FallbackImage src={p.image_url} thumbWidth={500} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />}
                <span className={`absolute top-3 right-3 grid place-items-center w-10 h-10 rounded-full text-[20px] ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white/90 text-[#7C838B]'}`}>
                  {on ? '♥' : '♡'}
                </span>
              </div>
              <p className="px-3 py-3 text-[20px] text-[#2B2B2B] leading-tight">{p.name}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

'use client'

// A VERDICT ON ONE LOOK — YES, or NO with the wrong piece named and, if it is
// a rule and not a one-off, a never written into the stylist's brief. Shared
// by the bench and the trials so both teach through the same control.

import { useState } from 'react'
import { neverCandidates, cleanWord, type NeverAttr } from '@/lib/never-words'
import type { BenchPiece } from './bench-run'

const LABEL = 'text-[9px] tracking-[0.12em] text-[#8B8880]'
const PILL = 'rounded-full px-4 py-2 text-[10px] tracking-[0.12em] disabled:opacity-40'
const CHIP = 'rounded-full border border-[#E2E0DB] px-2 py-0.5 text-[9px] tracking-[0.1em] text-[#6B6862]'

export interface VerdictSave {
  verdict: 'yes' | 'no'
  wrongItemIds: string[]
  nevers: { itemId: string; attr: NeverAttr; word: string }[]
}

type State =
  | { state: 'idle' }
  | { state: 'no'; wrong: string[]; nevers: string[]; typed: Record<string, string> } // nevers as `${itemId}:${attr}:${word}`
  | { state: 'saving' }
  | { state: 'saved'; verdict: 'yes' | 'no'; decisions: number; nevers_added: number }
  | { state: 'error'; error: string }

const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

export default function VerdictControls({
  pieces,
  onSave,
  initial,
}: {
  pieces: BenchPiece[]
  onSave: (v: VerdictSave) => Promise<{ error?: string; decisions?: number; nevers_added?: number }>
  /** A verdict already recorded (a trial run judged in an earlier session). */
  initial?: 'yes' | 'no' | null
}) {
  const [s, setS] = useState<State>(initial ? { state: 'saved', verdict: initial, decisions: 0, nevers_added: 0 } : { state: 'idle' })

  async function save(verdict: 'yes' | 'no') {
    const wrong = verdict === 'no' && s.state === 'no' ? s.wrong : []
    const nevers = verdict === 'no' && s.state === 'no'
      ? s.nevers.map((k) => { const [itemId, attr, ...rest] = k.split(':'); return { itemId, attr: attr as NeverAttr, word: rest.join(':') } })
      : []
    setS({ state: 'saving' })
    const r = await onSave({ verdict, wrongItemIds: wrong, nevers })
    setS(r.error ? { state: 'error', error: r.error } : { state: 'saved', verdict, decisions: r.decisions ?? 0, nevers_added: r.nevers_added ?? 0 })
  }

  if (s.state === 'saving') return <span className={LABEL}>TEACHING…</span>
  if (s.state === 'error') return <span className="text-[9px] tracking-[0.12em] text-[#9B3A3A]">{s.error.toUpperCase()}</span>
  if (s.state === 'saved') {
    return (
      <span className={LABEL}>
        {s.verdict.toUpperCase()}
        {s.decisions ? ` · TAUGHT · ${s.decisions} DECISION${s.decisions === 1 ? '' : 'S'}` : ''}
        {s.nevers_added ? ` · ${s.nevers_added} NEVER${s.nevers_added === 1 ? '' : 'S'} WRITTEN` : ''}
      </span>
    )
  }
  if (s.state === 'idle') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save('yes')} className={`${PILL} bg-[#141414] text-[#F7F6F3]`}>YES</button>
        <button type="button" onClick={() => setS({ state: 'no', wrong: [], nevers: [], typed: {} })} className={`${PILL} border border-[#E2E0DB] bg-white text-[#2B2B2B]`}>NO</button>
      </div>
    )
  }

  // NO: which piece is wrong, and what — if anything — becomes a never.
  const supporting = pieces.filter((p) => !p.is_hero && p.item_id)
  return (
    <div className="space-y-2">
      <p className={LABEL}>{s.wrong.length ? 'WRONG:' : 'TAP THE WRONG PIECE — OR SAVE A NO ON THE WHOLE LOOK'}</p>
      <div className="flex flex-wrap gap-1.5">
        {supporting.map((p) => {
          const on = s.wrong.includes(p.item_id!)
          return (
            <button key={p.item_id} type="button" title={`${p.brand} — ${p.product_name}`}
              onClick={() => setS({ ...s, wrong: toggle(s.wrong, p.item_id!), nevers: on ? s.nevers.filter((k) => !k.startsWith(`${p.item_id}:`)) : s.nevers })}
              className={`w-[44px] overflow-hidden rounded-[6px] ${on ? 'ring-2 ring-[#9B3A3A]' : 'opacity-70'}`}>
              {p.image_url ? <img src={p.image_url} alt="" className="aspect-[3/4] w-full object-cover" /> : <div className="aspect-[3/4] w-full bg-[#F2F1EE]" />}
            </button>
          )
        })}
      </div>
      {!!s.wrong.length && (
        <div className="space-y-2">
          {s.wrong.map((id) => {
            const p = pieces.find((x) => x.item_id === id)
            if (!p) return null
            // Every never this piece could become: its type, colour and brand,
            // then its material and the telling words of its name — so "wrong
            // bracelet style" can be NEVER MARBLE rather than NEVER BRACELET.
            const candidates = neverCandidates({ product_name: p.product_name, item_type: p.item_type, colour_family: p.colour_family, brand_name: p.brand, material_primary: p.material })
            const typed = s.typed[id] ?? ''
            const typedWord = cleanWord(typed)
            const typedKey = `${id}:word:${typedWord}`
            return (
              <div key={id} className="flex flex-wrap items-center gap-1.5">
                {candidates.map((c) => {
                  const key = `${id}:${c.attr}:${c.word}`
                  const on = s.nevers.includes(key)
                  return (
                    <button key={key} type="button" title={`Write "no ${c.word}" into her brief as a preference-never`}
                      onClick={() => setS({ ...s, nevers: toggle(s.nevers, key) })}
                      className={`${CHIP} ${on ? 'border-[#141414] bg-[#141414] text-[#F7F6F3]' : ''}`}>
                      NEVER {c.word.toUpperCase()}
                    </button>
                  )
                })}
                <input
                  value={typed}
                  onChange={(e) => setS({ ...s, typed: { ...s.typed, [id]: e.target.value } })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && typedWord) { e.preventDefault(); setS({ ...s, nevers: s.nevers.includes(typedKey) ? s.nevers : [...s.nevers, typedKey], typed: { ...s.typed, [id]: '' } }) } }}
                  placeholder="or a word of your own"
                  className="w-[150px] rounded-full border border-[#E2E0DB] px-2 py-0.5 text-[10px] text-[#0A0A0A]"
                />
                {s.nevers.filter((k) => k.startsWith(`${id}:word:`) && !candidates.some((c) => k === `${id}:word:${c.word}`)).map((k) => (
                  <button key={k} type="button" title="Remove" onClick={() => setS({ ...s, nevers: toggle(s.nevers, k) })}
                    className={`${CHIP} border-[#141414] bg-[#141414] text-[#F7F6F3]`}>
                    NEVER {k.split(':').slice(2).join(':').toUpperCase()} ×
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save('no')} className={`${PILL} bg-[#141414] text-[#F7F6F3]`}>SAVE NO</button>
        <button type="button" onClick={() => setS({ state: 'idle' })} className={`${PILL} border border-[#E2E0DB] bg-white text-[#2B2B2B]`}>CANCEL</button>
      </div>
    </div>
  )
}
